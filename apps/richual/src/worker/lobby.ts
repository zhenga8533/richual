import { DurableObject } from "cloudflare:workers";
import {
  type Action,
  type ApplyResult,
  applyAction,
  applyTimeout,
  createGame,
  endEarly,
  type GameEvent,
  type GameState,
  HERO_IDS,
  migrateState,
  startFinalRound,
  toPublicState,
} from "@richual/engine";
import {
  AUCTION_TIMER_SECONDS,
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
  rulesFromSettings,
  type ServerMessage,
  type SessionResponse,
} from "@richual/protocol";
import { generateToken, sha256Hex } from "./crypto";
import { createSchema, isInitialized, migrate } from "./schema";

/** Lobbies with no activity for this long are deleted. */
export const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HELLO_TIMEOUT_MS = 5_000;
/** How long the host may be disconnected before hosting passes to someone else. */
export const HOST_GRACE_MS = 2 * 60 * 1000;
const CHAT_HISTORY = 30;
/** Event batches (one per state change) kept for reconnecting clients' logs. */
const EVENT_HISTORY = 40;
/** Recently applied action ids, enough to recognise a client resending after a reconnect. */
const ACTION_ID_HISTORY = 50;
/** Token bucket per socket: bursts of this many messages, refilled at RATE_REFILL_PER_SEC. */
const RATE_BURST = 20;
const RATE_REFILL_PER_SEC = 5;
/** While paused, players may still negotiate; nothing executes until play resumes. */
const ALLOWED_WHILE_PAUSED = new Set<Action["type"]>([
  "proposeTrade",
  "cancelTrade",
  "rejectTrade",
]);

type Attachment = { playerId: string | null; connectedAt: number };

type LobbyRow = {
  code: string;
  host_id: string;
  last_active_at: number;
  status: LobbyStatus;
  settings_json: string;
  version: number;
  paused: number;
  play_ms: number;
  resumed_at: number | null;
  action_deadline: number | null;
  host_check_at: number | null;
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
 * sessions, sockets, clock and the authoritative game state. Every message is
 * handled synchronously after authentication, so actions within a lobby never
 * race. WebSockets use the Hibernation API so an idle lobby costs nothing; one
 * alarm drives every deadline (decision timers, the time limit, host handover
 * and idle cleanup).
 */
export class LobbyDO extends DurableObject<Env> {
  /** In memory only: losing it on hibernation merely resets the limits. */
  private readonly rateBuckets = new WeakMap<WebSocket, { tokens: number; at: number }>();

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
    createSchema(this.ctx.storage);
    this.sql.exec(
      "INSERT INTO lobby (id, code, host_id, created_at, last_active_at) VALUES (1, ?, ?, ?, ?)",
      code,
      playerId,
      now,
      now,
    );
    this.insertPlayer(playerId, hostName, 0, tokenHash, now);
    // A new lobby's only deadline is idle cleanup.
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
    if (!this.takeToken(ws)) {
      send(ws, { type: "error", error: "rate_limited", message: "Slow down a little" });
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
          break;
        case "updateSettings":
          this.updateSettings(playerId, msg.settings);
          break;
        case "startGame":
          this.startGame(playerId);
          break;
        case "returnToLobby":
          this.returnToLobby(playerId);
          break;
        case "pause":
          this.setPaused(playerId, true);
          break;
        case "resume":
          this.setPaused(playerId, false);
          break;
        case "endGame":
          this.requireHost(playerId);
          this.requireStatus("playing");
          this.commitGame(endEarly(this.game()), Date.now());
          break;
        case "chat":
          this.chat(playerId, msg.text);
          break;
        case "action":
          this.handleAction(ws, playerId, msg.clientActionId, msg.expectedVersion, msg.action);
          break;
      }
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      send(ws, { type: "error", error: error.code, message: error.message, clientActionId });
    }
    await this.scheduleAlarm();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    safeClose(ws, code, reason);
    await this.onDisconnect(ws);
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("lobby websocket error", error);
    await this.onDisconnect(ws);
  }

  override async alarm(): Promise<void> {
    let lobby = this.lobby();
    if (!lobby) return;
    const now = Date.now();
    if (now >= lobby.last_active_at + IDLE_TTL_MS) {
      console.log("deleting idle lobby", lobby.code);
      for (const ws of this.ctx.getWebSockets()) {
        safeClose(ws, CloseCode.LobbyClosed, "lobby expired");
      }
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }

    if (lobby.status === "playing" && !lobby.paused) {
      if (lobby.action_deadline !== null && now >= lobby.action_deadline) {
        this.commitGame(applyTimeout(this.game()), now);
        lobby = this.requireLobby();
      }
      const limitAt = this.timeLimitAt(lobby);
      if (lobby.status === "playing" && limitAt !== null && now >= limitAt) {
        this.commitGame(startFinalRound(this.game()), now);
      }
    }

    lobby = this.requireLobby();
    if (lobby.host_check_at !== null && now >= lobby.host_check_at) this.handOverHost(now);
    await this.scheduleAlarm(true);
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
    const now = Date.now();
    this.touch(now);
    const lobby = this.requireLobby();
    if (lobby.host_id === player.id) {
      this.sql.exec("UPDATE lobby SET host_check_at = NULL WHERE id = 1");
    } else if (!this.connectedIds().has(lobby.host_id) && lobby.host_check_at === null) {
      // The host left while nobody else was here to take over; start the clock now.
      this.sql.exec("UPDATE lobby SET host_check_at = ? WHERE id = 1", now + HOST_GRACE_MS);
    }
    send(ws, {
      type: "welcome",
      playerId: player.id,
      lobby: this.snapshot(),
      events: this.recentEvents(),
    });
    this.broadcast([], undefined, ws);
    await this.scheduleAlarm();
  }

  private async onDisconnect(ws: WebSocket): Promise<void> {
    const lobby = this.lobby();
    if (!lobby) return;
    if (attachment(ws).playerId === lobby.host_id) {
      this.sql.exec("UPDATE lobby SET host_check_at = ? WHERE id = 1", Date.now() + HOST_GRACE_MS);
      await this.scheduleAlarm();
    }
    this.broadcast([], ws);
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
      rulesFromSettings(settings),
      seed,
    );
    const now = Date.now();
    const first = state.players[state.turn.playerIndex];
    const events: GameEvent[] = first ? [{ type: "turnStarted", playerId: first.id }] : [];
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO game (id, state_json, updated_at, events_json, action_ids_json)
           VALUES (1, ?, ?, ?, '[]')
         ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json,
           updated_at = excluded.updated_at, events_json = excluded.events_json,
           action_ids_json = '[]'`,
        JSON.stringify(state),
        now,
        JSON.stringify(events.length > 0 ? [events] : []),
      );
      this.sql.exec(
        "UPDATE lobby SET status = 'playing', paused = 0, play_ms = 0, resumed_at = ?, action_deadline = ? WHERE id = 1",
        now,
        actionDeadline(state, settings, now),
      );
      this.bumpVersion(now);
    });
    this.broadcast(events);
  }

  private returnToLobby(playerId: string): void {
    this.requireHost(playerId);
    this.requireStatus("finished");
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM game");
      this.sql.exec(
        "UPDATE lobby SET status = 'open', paused = 0, play_ms = 0, resumed_at = NULL, action_deadline = NULL WHERE id = 1",
      );
      this.bumpVersion(Date.now());
    });
    this.broadcast([]);
  }

  private setPaused(playerId: string, paused: boolean): void {
    this.requireHost(playerId);
    const lobby = this.requireStatus("playing");
    if (Boolean(lobby.paused) === paused) {
      throw new RequestError(
        "rejected",
        paused ? "The game is already paused" : "The game is not paused",
      );
    }
    const now = Date.now();
    if (paused) {
      // Bank the active time so far; decision timers stop while paused.
      this.sql.exec(
        "UPDATE lobby SET paused = 1, play_ms = play_ms + ?, resumed_at = NULL, action_deadline = NULL WHERE id = 1",
        now - (lobby.resumed_at ?? now),
      );
    } else {
      // Whoever was deciding gets a fresh full timer after a pause.
      const deadline = actionDeadline(this.game(), parseSettings(lobby.settings_json), now);
      this.sql.exec(
        "UPDATE lobby SET paused = 0, resumed_at = ?, action_deadline = ? WHERE id = 1",
        now,
        deadline,
      );
    }
    this.bumpVersion(now);
    this.broadcast([]);
  }

  private chat(playerId: string, text: string): void {
    const now = Date.now();
    this.sql.exec("INSERT INTO chat (player_id, text, at) VALUES (?, ?, ?)", playerId, text, now);
    this.sql.exec("DELETE FROM chat WHERE seq <= (SELECT MAX(seq) FROM chat) - ?", CHAT_HISTORY);
    // Chat never bumps the version, so it cannot make anyone's pending action stale.
    this.touch(now);
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

    if (this.recentActionIds().includes(actionKey(playerId, clientActionId))) {
      // A retried send of an action we already applied: confirm it, don't apply it twice.
      send(ws, { type: "ack", clientActionId });
      return;
    }

    if (lobby.paused && !ALLOWED_WHILE_PAUSED.has(action.type)) {
      throw new RequestError("paused", "The game is paused");
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
    this.commitGame(result, Date.now(), { playerId, clientActionId });
    send(ws, { type: "ack", clientActionId });
  }

  /**
   * Persists a new game state with everything that depends on it (status,
   * clock, decision timer, version) in one transaction, then broadcasts it.
   */
  private commitGame(
    result: ApplyResult,
    now: number,
    logged?: { playerId: string; clientActionId: string },
  ): void {
    if (!result.ok) throw new RequestError("rejected", result.error.message);
    const { state, events } = result;
    const lobby = this.requireLobby();
    const finished = state.phase.kind === "gameOver";
    // Trade talk while paused leaves the clocks stopped.
    const deadline = lobby.paused
      ? null
      : actionDeadline(state, parseSettings(lobby.settings_json), now);

    const row = this.gameRow();
    const eventBatches = JSON.parse(row.events_json) as GameEvent[][];
    if (events.length > 0) eventBatches.push(events);
    const actionIds = JSON.parse(row.action_ids_json) as string[];
    if (logged) actionIds.push(actionKey(logged.playerId, logged.clientActionId));

    // Exactly two row writes: the game and the lobby.
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "UPDATE game SET state_json = ?, updated_at = ?, events_json = ?, action_ids_json = ? WHERE id = 1",
        JSON.stringify(state),
        now,
        JSON.stringify(eventBatches.slice(-EVENT_HISTORY)),
        JSON.stringify(actionIds.slice(-ACTION_ID_HISTORY)),
      );
      if (finished) {
        this.sql.exec(
          `UPDATE lobby SET status = 'finished', paused = 0, play_ms = play_ms + ?,
             resumed_at = NULL, action_deadline = NULL, version = version + 1, last_active_at = ?
           WHERE id = 1`,
          lobby.resumed_at === null ? 0 : now - lobby.resumed_at,
          now,
        );
      } else {
        this.sql.exec(
          "UPDATE lobby SET action_deadline = ?, version = version + 1, last_active_at = ? WHERE id = 1",
          deadline,
          now,
        );
      }
    });
    this.broadcast(events);
  }

  /** Passes hosting to the longest-connected player if the host is still away. */
  private handOverHost(now: number): void {
    const lobby = this.requireLobby();
    this.sql.exec("UPDATE lobby SET host_check_at = NULL WHERE id = 1");
    if (this.connectedIds().has(lobby.host_id)) return;
    const successor = this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN && attachment(ws).playerId !== null)
      .sort((a, b) => attachment(a).connectedAt - attachment(b).connectedAt)[0];
    const successorId = successor ? attachment(successor).playerId : null;
    if (!successorId) return;
    this.sql.exec("UPDATE lobby SET host_id = ? WHERE id = 1", successorId);
    this.bumpVersion(now);
    this.broadcast([]);
  }

  // ---------- Deadlines ----------

  /** When active play reaches the time limit, or null if there is no running limit. */
  private timeLimitAt(lobby: LobbyRow): number | null {
    const { limit } = parseSettings(lobby.settings_json);
    if (limit.kind !== "minutes" || lobby.status !== "playing" || lobby.resumed_at === null) {
      return null;
    }
    if (this.game().finalRound !== null) return null;
    return lobby.resumed_at + limit.minutes * 60_000 - lobby.play_ms;
  }

  /** @param afterFiring set when called from alarm(), which must always set the next one */
  private async scheduleAlarm(afterFiring = false): Promise<void> {
    const lobby = this.lobby();
    if (!lobby) return;
    const candidates = [
      lobby.last_active_at + IDLE_TTL_MS,
      lobby.status === "playing" && !lobby.paused ? lobby.action_deadline : null,
      this.timeLimitAt(lobby),
      lobby.host_check_at,
    ].filter((t): t is number => t !== null);
    const next = Math.min(...candidates);
    // Only ever bring the alarm forward. Pushing it back on every action (the idle
    // deadline moves each time) would cost a write per action; an alarm that fires
    // early just finds nothing due and reschedules itself.
    const current = afterFiring ? null : await this.ctx.storage.getAlarm();
    if (current === null || next < current) await this.ctx.storage.setAlarm(next);
  }

  private takeToken(ws: WebSocket): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(ws) ?? { tokens: RATE_BURST, at: now };
    bucket.tokens = Math.min(
      RATE_BURST,
      bucket.tokens + ((now - bucket.at) / 1000) * RATE_REFILL_PER_SEC,
    );
    bucket.at = now;
    if (bucket.tokens < 1) {
      this.rateBuckets.set(ws, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.rateBuckets.set(ws, bucket);
    return true;
  }

  // ---------- Storage ----------

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private lobby(): LobbyRow | undefined {
    if (!isInitialized(this.sql)) return undefined;
    return this.sql
      .exec<LobbyRow>(
        `SELECT code, host_id, last_active_at, status, settings_json, version, paused, play_ms,
                resumed_at, action_deadline, host_check_at
           FROM lobby WHERE id = 1`,
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

  private gameRow(): { events_json: string; action_ids_json: string } {
    const row = this.sql
      .exec<{ events_json: string; action_ids_json: string }>(
        "SELECT events_json, action_ids_json FROM game WHERE id = 1",
      )
      .toArray()[0];
    if (!row) throw new Error("lobby is playing but has no game row");
    return row;
  }

  /** Recent events, oldest first; empty when no game has started. */
  private recentEvents(): GameEvent[] {
    const row = this.sql
      .exec<{ events_json: string }>("SELECT events_json FROM game WHERE id = 1")
      .toArray()[0];
    return row ? (JSON.parse(row.events_json) as GameEvent[][]).flat() : [];
  }

  private recentActionIds(): string[] {
    return JSON.parse(this.gameRow().action_ids_json) as string[];
  }

  private touch(now: number): void {
    this.sql.exec("UPDATE lobby SET last_active_at = ? WHERE id = 1", now);
  }

  private bumpVersion(now: number): void {
    this.sql.exec("UPDATE lobby SET version = version + 1, last_active_at = ? WHERE id = 1", now);
  }

  // ---------- Snapshots ----------

  private connectedIds(closing?: WebSocket): Set<string | null> {
    return new Set(
      this.ctx
        .getWebSockets()
        .filter((ws) => ws !== closing && ws.readyState === WebSocket.OPEN)
        .map((ws) => attachment(ws).playerId),
    );
  }

  /** @param closing a socket that is closing and must not count as connected */
  private snapshot(closing?: WebSocket): LobbySnapshot {
    const lobby = this.requireLobby();
    const settings = parseSettings(lobby.settings_json);
    const connected = this.connectedIds(closing);
    const players = this.players().map((p) => ({
      ...p,
      hero: (HERO_IDS as readonly string[]).includes(p.hero ?? "")
        ? (p.hero as LobbySnapshot["players"][number]["hero"])
        : null,
      connected: connected.has(p.id),
    }));
    const chat = this.sql
      .exec<{ seq: number; player_id: string; text: string; at: number }>(
        "SELECT seq, player_id, text, at FROM chat ORDER BY seq",
      )
      .toArray()
      .map((m) => ({ id: m.seq, playerId: m.player_id, text: m.text, at: m.at }));
    return {
      code: lobby.code,
      hostId: lobby.host_id,
      status: lobby.status,
      version: lobby.version,
      settings,
      players,
      game: lobby.status === "open" ? null : toPublicState(this.game()),
      paused: Boolean(lobby.paused),
      clock: {
        playMs: lobby.play_ms,
        resumedAt: lobby.resumed_at,
        limitMs: settings.limit.kind === "minutes" ? settings.limit.minutes * 60_000 : null,
      },
      actionDeadline: lobby.status === "playing" && !lobby.paused ? lobby.action_deadline : null,
      serverNow: Date.now(),
      chat,
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

/** When the current decision will be auto-played: auctions always, other decisions if the host set a timer. */
function actionDeadline(state: GameState, settings: LobbySettings, now: number): number | null {
  if (state.phase.kind === "gameOver") return null;
  if (state.phase.kind === "auction") return now + AUCTION_TIMER_SECONDS * 1000;
  return settings.turnTimerSeconds > 0 ? now + settings.turnTimerSeconds * 1000 : null;
}

function parseSettings(json: string): LobbySettings {
  const parsed = LobbySettings.safeParse(JSON.parse(json));
  if (!parsed.success) {
    throw new Error(`stored lobby settings are invalid: ${parsed.error.message}`);
  }
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

/** Identifies an applied action for duplicate detection; client ids are only unique per player. */
function actionKey(playerId: string, clientActionId: string): string {
  return `${playerId}:${clientActionId}`;
}
