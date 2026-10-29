import { DurableObject } from "cloudflare:workers";
import {
  type Action,
  applyAction,
  CLASSIC_RULES,
  createGame,
  type GameEvent,
  type GameState,
  HERO_IDS,
  migrateState,
  toPublicState,
} from "@richual/engine";
import {
  ClientMessage,
  CloseCode,
  type ErrorCode,
  LobbySettings,
  type LobbySnapshot,
  type LobbyStatus,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  PING,
  PONG,
  PROTOCOL_VERSION,
  type ServerMessage,
  type SessionResponse,
} from "@richual/protocol";
import { generateToken, sha256Hex } from "./crypto";
import { isInitialized, migrate } from "./schema";

/** Lobbies with no activity for this long are deleted. */
export const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HELLO_TIMEOUT_MS = 5_000;

type Attachment = { playerId: string | null; connectedAt: number };

type LobbyRow = {
  code: string;
  host_id: string;
  last_active_at: number;
  status: LobbyStatus;
  settings_json: string;
  version: number;
};
type PlayerRow = { id: string; name: string; seat: number; hero: string | null };

export type JoinResult =
  | { ok: true; session: SessionResponse }
  | { ok: false; error: ErrorCode; message: string };

class RequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One instance per lobby, addressed by invite code. Owns the lobby's players,
 * sessions, sockets and the authoritative game state. Every message is handled
 * synchronously after authentication, so actions within a lobby never race.
 * WebSockets use the Hibernation API so an idle lobby costs nothing.
 */
export class LobbyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    // Only upgrade lobbies that exist; probing an unknown code must not create storage.
    if (isInitialized(ctx.storage.sql)) migrate(ctx.storage);
  }

  /** Initializes a new lobby. Returns null if this code is already taken. */
  async create(code: string, hostName: string): Promise<SessionResponse | null> {
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    if (isInitialized(this.sql)) return null;

    const now = Date.now();
    const playerId = crypto.randomUUID();
    migrate(this.ctx.storage);
    this.sql.exec(
      "INSERT INTO lobby (id, code, host_id, created_at, last_active_at) VALUES (1, ?, ?, ?, ?)",
      code,
      playerId,
      now,
      now,
    );
    this.insertPlayer(playerId, hostName, 0, tokenHash, now);
    await this.ctx.storage.setAlarm(now + IDLE_TTL_MS);
    return { code, playerId, token };
  }

  async join(name: string): Promise<JoinResult> {
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    // Everything below is synchronous, so concurrent joins cannot claim the same seat.
    const lobby = this.lobby();
    if (!lobby) return { ok: false, error: "not_found", message: "Lobby not found" };
    if (lobby.status !== "open") {
      return { ok: false, error: "game_in_progress", message: "This game has already started" };
    }

    const taken = new Set(this.players().map((p) => p.seat));
    const seat = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((i) => !taken.has(i));
    if (seat === undefined) return { ok: false, error: "lobby_full", message: "Lobby is full" };

    const playerId = crypto.randomUUID();
    const now = Date.now();
    this.insertPlayer(playerId, name, seat, tokenHash, now);
    this.bumpVersion(now);
    this.broadcast([]);
    return { ok: true, session: { code: lobby.code, playerId, token } };
  }

  override async fetch(request: Request): Promise<Response> {
    if (!this.lobby()) {
      return Response.json({ error: "not_found", message: "Lobby not found" }, { status: 404 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null, connectedAt: Date.now() } satisfies Attachment);
    // The pending timer keeps the object awake for at most this long, which is fine.
    setTimeout(() => {
      if (attachment(server).playerId === null) {
        safeClose(server, CloseCode.HelloTimeout, "hello timeout");
      }
    }, HELLO_TIMEOUT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) {
      safeClose(ws, 1009, "message too large or not text");
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      send(ws, { type: "error", error: "bad_request", message: "Invalid JSON" });
      return;
    }
    const parsed = ClientMessage.safeParse(json);
    if (!parsed.success) {
      send(ws, { type: "error", error: "bad_request", message: "Unknown or malformed message" });
      return;
    }

    const msg = parsed.data;
    if (msg.type === "hello") {
      await this.handleHello(ws, msg.protocol, msg.token);
      return;
    }

    const { playerId } = attachment(ws);
    if (playerId === null) {
      send(ws, { type: "error", error: "unauthorized", message: "Say hello first" });
      safeClose(ws, CloseCode.Unauthorized, "unauthorized");
      return;
    }

    const clientActionId = msg.type === "action" ? msg.clientActionId : undefined;
    try {
      switch (msg.type) {
        case "setHero":
          this.setHero(playerId, msg.hero);
          return;
        case "updateSettings":
          this.updateSettings(playerId, msg.settings);
          return;
        case "startGame":
          this.startGame(playerId);
          return;
        case "returnToLobby":
          this.returnToLobby(playerId);
          return;
        case "action":
          this.handleAction(ws, playerId, msg.clientActionId, msg.expectedVersion, msg.action);
          return;
      }
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      send(ws, { type: "error", error: error.code, message: error.message, clientActionId });
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    safeClose(ws, code, reason);
    this.broadcast([], ws);
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("lobby websocket error", error);
    this.broadcast([], ws);
  }

  override async alarm(): Promise<void> {
    const lobby = this.lobby();
    if (!lobby) return;
    const expiresAt = lobby.last_active_at + IDLE_TTL_MS;
    if (Date.now() < expiresAt) {
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }
    console.log("deleting idle lobby", lobby.code);
    for (const ws of this.ctx.getWebSockets())
      safeClose(ws, CloseCode.LobbyClosed, "lobby expired");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---------- Message handlers ----------

  private async handleHello(ws: WebSocket, protocol: number, token: string): Promise<void> {
    if (protocol !== PROTOCOL_VERSION) {
      send(ws, {
        type: "error",
        error: "protocol_mismatch",
        message: "Your client is out of date. Please reload.",
      });
      safeClose(ws, CloseCode.ProtocolMismatch, "protocol mismatch");
      return;
    }
    const tokenHash = await sha256Hex(token);
    const player = this.sql
      .exec<{ id: string }>("SELECT id FROM players WHERE token_hash = ?", tokenHash)
      .toArray()[0];
    if (!player) {
      send(ws, { type: "error", error: "unauthorized", message: "Invalid session" });
      safeClose(ws, CloseCode.Unauthorized, "unauthorized");
      return;
    }

    // One live connection per seat: a newer tab replaces the older one.
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && attachment(other).playerId === player.id) {
        safeClose(other, CloseCode.Replaced, "connected elsewhere");
      }
    }
    ws.serializeAttachment({ ...attachment(ws), playerId: player.id } satisfies Attachment);
    this.touch(Date.now());
    send(ws, { type: "welcome", playerId: player.id, lobby: this.snapshot() });
    this.broadcast([], undefined, ws);
  }

  private setHero(playerId: string, hero: string): void {
    this.requireStatus("open");
    const holder = this.sql
      .exec<{ id: string }>("SELECT id FROM players WHERE hero = ?", hero)
      .toArray()[0];
    if (holder && holder.id !== playerId) {
      throw new RequestError("rejected", "Another player already chose that hero");
    }
    this.sql.exec("UPDATE players SET hero = ? WHERE id = ?", hero, playerId);
    this.bumpVersion(Date.now());
    this.broadcast([]);
  }

  private updateSettings(playerId: string, settings: LobbySettings): void {
    this.requireHost(playerId);
    this.requireStatus("open");
    this.sql.exec("UPDATE lobby SET settings_json = ? WHERE id = 1", JSON.stringify(settings));
    this.bumpVersion(Date.now());
    this.broadcast([]);
  }

  private startGame(playerId: string): void {
    this.requireHost(playerId);
    const lobby = this.requireStatus("open");
    const players = this.players();
    if (players.length < 2) throw new RequestError("rejected", "At least two players are needed");

    const settings = parseSettings(lobby.settings_json);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    const state = createGame(
      players.map((p) => ({ id: p.id, name: p.name })),
      { ...CLASSIC_RULES, ...settings, limitedBuildings: settings.evenBuilding },
      seed,
    );
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM actions");
      this.sql.exec(
        "INSERT INTO game (id, state_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
        JSON.stringify(state),
        now,
      );
      this.sql.exec("UPDATE lobby SET status = 'playing' WHERE id = 1");
      this.bumpVersion(now);
    });
    const first = state.players[state.turn.playerIndex];
    this.broadcast(first ? [{ type: "turnStarted", playerId: first.id }] : []);
  }

  private returnToLobby(playerId: string): void {
    this.requireHost(playerId);
    this.requireStatus("finished");
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM game");
      this.sql.exec("DELETE FROM actions");
      this.sql.exec("UPDATE lobby SET status = 'open' WHERE id = 1");
      this.bumpVersion(Date.now());
    });
    this.broadcast([]);
  }

  private handleAction(
    ws: WebSocket,
    playerId: string,
    clientActionId: string,
    expectedVersion: number,
    action: Action,
  ): void {
    const lobby = this.requireStatus("playing");

    const duplicate = this.sql
      .exec(
        "SELECT 1 FROM actions WHERE player_id = ? AND client_action_id = ?",
        playerId,
        clientActionId,
      )
      .toArray();
    if (duplicate.length > 0) {
      // A retried send of an action we already applied: confirm it, don't apply it twice.
      send(ws, { type: "ack", clientActionId });
      return;
    }

    if (expectedVersion !== lobby.version) {
      send(ws, {
        type: "error",
        error: "stale",
        message: "The game changed before your action arrived",
        clientActionId,
      });
      send(ws, { type: "lobby", lobby: this.snapshot(), events: [] });
      return;
    }

    const result = applyAction(this.game(), playerId, action);
    if (!result.ok) throw new RequestError("rejected", result.error.message);

    const now = Date.now();
    const finished = result.state.phase.kind === "gameOver";
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "UPDATE game SET state_json = ?, updated_at = ? WHERE id = 1",
        JSON.stringify(result.state),
        now,
      );
      this.sql.exec(
        "INSERT INTO actions (player_id, client_action_id, action_json, at) VALUES (?, ?, ?, ?)",
        playerId,
        clientActionId,
        JSON.stringify(action),
        now,
      );
      if (finished) this.sql.exec("UPDATE lobby SET status = 'finished' WHERE id = 1");
      this.bumpVersion(now);
    });
    send(ws, { type: "ack", clientActionId });
    this.broadcast(result.events);
  }

  // ---------- Storage ----------

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private lobby(): LobbyRow | undefined {
    if (!isInitialized(this.sql)) return undefined;
    return this.sql
      .exec<LobbyRow>(
        "SELECT code, host_id, last_active_at, status, settings_json, version FROM lobby WHERE id = 1",
      )
      .toArray()[0];
  }

  private requireLobby(): LobbyRow {
    const lobby = this.lobby();
    if (!lobby) throw new RequestError("not_found", "Lobby not found");
    return lobby;
  }

  private requireStatus(status: LobbyStatus): LobbyRow {
    const lobby = this.requireLobby();
    if (lobby.status !== status) {
      const message = {
        open: "The game has already started",
        playing: "No game is in progress",
        finished: "The game is not over yet",
      }[status];
      throw new RequestError("rejected", message);
    }
    return lobby;
  }

  private requireHost(playerId: string): void {
    if (this.requireLobby().host_id !== playerId) {
      throw new RequestError("forbidden", "Only the host can do that");
    }
  }

  private players(): PlayerRow[] {
    return this.sql
      .exec<PlayerRow>("SELECT id, name, seat, hero FROM players ORDER BY seat")
      .toArray();
  }

  private game(): GameState {
    const row = this.sql
      .exec<{ state_json: string }>("SELECT state_json FROM game WHERE id = 1")
      .toArray()[0];
    if (!row) throw new Error("lobby is playing but has no game row");
    return migrateState(JSON.parse(row.state_json));
  }

  private insertPlayer(id: string, name: string, seat: number, tokenHash: string, now: number) {
    const taken = new Set(this.players().map((p) => p.hero));
    const hero = HERO_IDS.find((h) => !taken.has(h)) ?? null;
    this.sql.exec(
      "INSERT INTO players (id, name, seat, hero, token_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      name,
      seat,
      hero,
      tokenHash,
      now,
    );
  }

  private touch(now: number): void {
    this.sql.exec("UPDATE lobby SET last_active_at = ? WHERE id = 1", now);
  }

  private bumpVersion(now: number): void {
    this.sql.exec("UPDATE lobby SET version = version + 1, last_active_at = ? WHERE id = 1", now);
  }

  // ---------- Snapshots ----------

  /** @param closing a socket that is closing and must not count as connected */
  private snapshot(closing?: WebSocket): LobbySnapshot {
    const lobby = this.requireLobby();
    const connected = new Set(
      this.ctx
        .getWebSockets()
        .filter((ws) => ws !== closing && ws.readyState === WebSocket.OPEN)
        .map((ws) => attachment(ws).playerId),
    );
    const players = this.players().map((p) => ({
      ...p,
      hero: (HERO_IDS as readonly string[]).includes(p.hero ?? "")
        ? (p.hero as LobbySnapshot["players"][number]["hero"])
        : null,
      connected: connected.has(p.id),
    }));
    return {
      code: lobby.code,
      hostId: lobby.host_id,
      status: lobby.status,
      version: lobby.version,
      settings: parseSettings(lobby.settings_json),
      players,
      game: lobby.status === "open" ? null : toPublicState(this.game()),
    };
  }

  private broadcast(events: GameEvent[], closing?: WebSocket, skip?: WebSocket): void {
    if (!this.lobby()) return;
    const message: ServerMessage = { type: "lobby", lobby: this.snapshot(closing), events };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing || ws === skip || attachment(ws).playerId === null) continue;
      send(ws, message);
    }
  }
}

function parseSettings(json: string): LobbySettings {
  const parsed = LobbySettings.safeParse(JSON.parse(json));
  if (!parsed.success)
    throw new Error(`stored lobby settings are invalid: ${parsed.error.message}`);
  return parsed.data;
}

function attachment(ws: WebSocket): Attachment {
  return ws.deserializeAttachment() as Attachment;
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch (error) {
    // The socket closed between the check and the send; its close handler will clean up.
    console.warn("send to closed websocket failed", error);
  }
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closing or closed.
  }
}
