import { DurableObject } from "cloudflare:workers";
import {
  type Action,
  type ApplyResult,
  applyAction,
  applyTimeout,
  type BotLevel,
  botAction,
  createGame,
  endEarly,
  type GameEvent,
  type GameState,
  HERO_IDS,
  heroName,
  migrateState,
  startFinalRound,
  toPublicState,
} from "@richual/engine";
import {
  AUCTION_TIMER_SECONDS,
  ClientMessage,
  CloseCode,
  type ErrorCode,
  type LobbyInfo,
  LobbySettings,
  type LobbySnapshot,
  type LobbyStatus,
  type LobbySummary,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  PING,
  PONG,
  PROTOCOL_VERSION,
  rulesFromSettings,
  SEAT_CODE_TTL_MS,
  type ServerMessage,
  type SessionResponse,
} from "@richual/protocol";
import { generateLobbyCode, generateToken, hashPasscode, passcodeSalt, sha256Hex } from "./crypto";
import { LISTING_TTL_MS, type Listing } from "./directory";
import { createSchema, isInitialized, migrate } from "./schema";

/** Lobbies with no activity for this long are deleted. */
export const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HELLO_TIMEOUT_MS = 5_000;
/** How long the host may be disconnected before hosting passes to someone else. */
export const HOST_GRACE_MS = 2 * 60 * 1000;
/** Pause before each bot move, so people can follow what the bot did. */
export const BOT_DELAY_MS = 900;
/**
 * Wrong passcodes a lobby accepts per window before every join has to wait it out.
 * Each client also gets only a few guesses (LIMITS.passcodeGuess), so no single
 * client can lock a listed lobby on its own.
 */
export const PASSCODE_MAX_FAILURES = 50;
export const PASSCODE_WINDOW_MS = 10 * 60 * 1000;
/** A listed lobby re-sends its listing this often, well inside the directory's TTL. */
export const LISTING_REFRESH_MS = LISTING_TTL_MS / 2;
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
  bot_due_at: number | null;
  passcode_hash: string | null;
  passcode_failures: number;
  passcode_failed_at: number | null;
};
type PlayerRow = {
  id: string;
  name: string;
  seat: number;
  hero: string | null;
  kind: "human" | "bot";
  bot_level: BotLevel | null;
};

export type JoinResult =
  | { ok: true; session: SessionResponse }
  | { ok: false; error: ErrorCode; message: string; retryAfterMs?: number };

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

  async join(name: string, passcode?: string): Promise<JoinResult> {
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    const stored = this.lobby()?.passcode_hash;
    const attempt = stored && passcode ? await hashPasscode(passcode, passcodeSalt(stored)) : null;
    // Everything below is synchronous, so concurrent joins cannot claim the same seat.
    const lobby = this.lobby();
    if (!lobby) return { ok: false, error: "not_found", message: "Lobby not found" };
    if (lobby.status !== "open") {
      return { ok: false, error: "game_in_progress", message: "This game has already started" };
    }
    // The guess was hashed with a salt the host has since replaced; don't count it.
    if (passcode && lobby.passcode_hash && lobby.passcode_hash !== stored) {
      return {
        ok: false,
        error: "wrong_passcode",
        message: "The passcode just changed. Try again.",
      };
    }
    const refused = this.checkPasscode(lobby, passcode, attempt);
    if (refused) return refused;

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
      // A browser can't read why an upgrade failed and would retry forever, so a client
      // still holding a session for a closed or expired lobby is told so with a close code.
      // The socket isn't hibernatable and nothing is stored.
      if (request.headers.get("Upgrade") === "websocket") {
        const { 0: client, 1: server } = new WebSocketPair();
        server.accept();
        server.close(CloseCode.LobbyClosed, "lobby not found");
        return new Response(null, { status: 101, webSocket: client });
      }
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
    // A socket opened just before the lobby was deleted can still deliver its hello.
    if (!this.lobby()) {
      safeClose(ws, CloseCode.LobbyClosed, "lobby closed");
      return;
    }
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
          await this.updateSettings(playerId, msg.settings, msg.passcode);
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
        case "addBot":
          this.addBot(playerId, msg.level);
          break;
        case "setBotLevel":
          this.setBotLevel(playerId, msg.playerId, msg.level);
          break;
        case "removePlayer":
          this.removePlayer(playerId, msg.playerId);
          break;
        case "replaceWithBot":
          this.replaceWithBot(playerId, msg.playerId, msg.level);
          break;
        case "setHost":
          this.setHost(playerId, msg.playerId);
          break;
        case "rematch":
          this.returnToLobby(playerId);
          this.startGame(playerId);
          break;
        case "createSeatCode":
          await this.createSeatCode(ws, playerId);
          break;
        case "closeLobby":
          this.requireHost(playerId);
          console.log("host closed lobby", this.requireLobby().code);
          await this.deleteLobby("closed by the host");
          return;
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

  /**
   * Disconnects everyone, takes down any public listing and wipes all storage,
   * so the code stops working. Their saved sessions end with LobbyClosed.
   */
  private async deleteLobby(reason: string): Promise<void> {
    const lobby = this.requireLobby();
    const { code } = lobby;
    const listed = parseSettings(lobby.settings_json).visibility !== "private";
    // Storage goes first: nothing else runs during storage awaits, and once it is
    // gone no join, socket or listing sync can bring the lobby back.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.listedAs = undefined;
    this.listedAt = null;
    for (const ws of this.ctx.getWebSockets()) {
      safeClose(ws, CloseCode.LobbyClosed, reason);
    }
    if (listed) {
      await this.directory()
        .remove(code)
        .catch((error: unknown) => console.error("directory remove failed", code, error));
    }
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
      await this.deleteLobby("lobby expired");
      return;
    }

    if (lobby.status === "playing" && !lobby.paused) {
      if (lobby.action_deadline !== null && now >= lobby.action_deadline) {
        this.commitGame(applyTimeout(this.game()), now);
        lobby = this.requireLobby();
      }
      if (lobby.status === "playing" && lobby.bot_due_at !== null && now >= lobby.bot_due_at) {
        this.playBotMove(now);
        lobby = this.requireLobby();
      }
      const limitAt = this.timeLimitAt(lobby);
      if (lobby.status === "playing" && limitAt !== null && now >= limitAt) {
        this.commitGame(startFinalRound(this.game()), now);
      }
    }

    lobby = this.requireLobby();
    if (lobby.host_check_at !== null && now >= lobby.host_check_at) this.handOverHost(now);
    this.syncListing();
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
    // The lobby may have been closed while the hash was computed.
    if (!this.lobby()) {
      safeClose(ws, CloseCode.LobbyClosed, "lobby closed");
      return;
    }
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

  private async updateSettings(
    playerId: string,
    settings: LobbySettings,
    passcode: string | undefined,
  ): Promise<void> {
    this.requireHost(playerId);
    const newHash = passcode === undefined ? undefined : await hashPasscode(passcode);
    // Read after hashing: the lobby can change while the hash is computed.
    const lobby = this.requireStatus("open");
    const hash = settings.visibility === "passcode" ? (newHash ?? lobby.passcode_hash) : null;
    if (settings.visibility === "passcode" && !hash) {
      throw new RequestError("rejected", "Choose a passcode first");
    }
    // After a wake-up the lobby doesn't know it was listed; make the next sync remove it.
    if (
      settings.visibility === "private" &&
      parseSettings(lobby.settings_json).visibility !== "private" &&
      this.listedAs === undefined
    ) {
      this.listedAs = "unknown";
    }
    this.sql.exec("UPDATE lobby SET settings_json = ? WHERE id = 1", JSON.stringify(settings));
    if (hash !== lobby.passcode_hash) {
      this.sql.exec(
        "UPDATE lobby SET passcode_hash = ?, passcode_failures = 0, passcode_failed_at = NULL WHERE id = 1",
        hash,
      );
    }
    this.bumpVersion(Date.now());
    this.broadcast([]);
  }

  /**
   * Refuses a join without the right passcode, counting wrong ones. After
   * PASSCODE_MAX_FAILURES in a window every join waits, so guessing stays slow.
   */
  private checkPasscode(
    lobby: LobbyRow,
    passcode: string | undefined,
    attempt: string | null,
  ): JoinResult | null {
    if (!lobby.passcode_hash) return null;
    const now = Date.now();
    const windowOpen =
      lobby.passcode_failed_at !== null && now - lobby.passcode_failed_at < PASSCODE_WINDOW_MS;
    if (windowOpen && lobby.passcode_failures >= PASSCODE_MAX_FAILURES) {
      const retryAfterMs = (lobby.passcode_failed_at ?? now) + PASSCODE_WINDOW_MS - now;
      const minutes = Math.ceil(retryAfterMs / 60_000);
      return {
        ok: false,
        error: "rate_limited",
        message: `Too many wrong passcodes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        retryAfterMs,
      };
    }
    if (!passcode) {
      return { ok: false, error: "passcode_required", message: "This lobby needs a passcode" };
    }
    if (attempt === lobby.passcode_hash) return null;
    if (windowOpen) {
      this.sql.exec("UPDATE lobby SET passcode_failures = passcode_failures + 1 WHERE id = 1");
    } else {
      this.sql.exec(
        "UPDATE lobby SET passcode_failures = 1, passcode_failed_at = ? WHERE id = 1",
        now,
      );
    }
    return { ok: false, error: "wrong_passcode", message: "That passcode isn't right" };
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
        "UPDATE lobby SET status = 'playing', paused = 0, play_ms = 0, resumed_at = ?, action_deadline = ?, bot_due_at = ? WHERE id = 1",
        now,
        actionDeadline(state, settings, now, this.botIds()),
        this.nextBotDue(state, now),
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
        "UPDATE lobby SET status = 'open', paused = 0, play_ms = 0, resumed_at = NULL, action_deadline = NULL, bot_due_at = NULL WHERE id = 1",
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
        "UPDATE lobby SET paused = 1, play_ms = play_ms + ?, resumed_at = NULL, action_deadline = NULL, bot_due_at = NULL WHERE id = 1",
        now - (lobby.resumed_at ?? now),
      );
    } else {
      // Whoever was deciding gets a fresh full timer after a pause.
      const game = this.game();
      const deadline = actionDeadline(game, parseSettings(lobby.settings_json), now, this.botIds());
      this.sql.exec(
        "UPDATE lobby SET paused = 0, resumed_at = ?, action_deadline = ?, bot_due_at = ? WHERE id = 1",
        now,
        deadline,
        this.nextBotDue(game, now),
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
    // Trade talk while paused leaves the clocks stopped, and bots wait too.
    const deadline = lobby.paused
      ? null
      : actionDeadline(state, parseSettings(lobby.settings_json), now, this.botIds());
    const botDue = lobby.paused ? null : this.nextBotDue(state, now);

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
             resumed_at = NULL, action_deadline = NULL, bot_due_at = NULL,
             version = version + 1, last_active_at = ?
           WHERE id = 1`,
          lobby.resumed_at === null ? 0 : now - lobby.resumed_at,
          now,
        );
      } else {
        this.sql.exec(
          "UPDATE lobby SET action_deadline = ?, bot_due_at = ?, version = version + 1, last_active_at = ? WHERE id = 1",
          deadline,
          botDue,
          now,
        );
      }
    });
    if (finished) this.logGameSummary(state, lobby, now);
    this.broadcast(events);
  }

  /** One line per finished game in Workers logs: the data for tuning game length. */
  private logGameSummary(state: GameState, lobby: LobbyRow, now: number): void {
    if (state.phase.kind !== "gameOver") return;
    const settings = parseSettings(lobby.settings_json);
    console.log(
      JSON.stringify({
        event: "gameFinished",
        mode: settings.mode,
        limit: settings.limit,
        speedDie: settings.speedDie,
        players: state.players.length,
        bots: this.bots().map((b) => b.level),
        rounds: state.turn.round,
        turns: state.turn.number,
        playMinutes: Math.round(
          (lobby.play_ms + (lobby.resumed_at === null ? 0 : now - lobby.resumed_at)) / 60_000,
        ),
        reason: state.phase.reason,
      }),
    );
  }

  // ---------- Bots ----------

  private bots(): { id: string; level: BotLevel }[] {
    return this.players()
      .filter((p) => p.kind === "bot")
      .map((p) => ({ id: p.id, level: p.bot_level ?? "normal" }));
  }

  private botIds(): string[] {
    return this.bots().map((b) => b.id);
  }

  /** When the next bot move is due, or null if no bot has anything to do. */
  private nextBotDue(state: GameState, now: number): number | null {
    if (state.phase.kind === "gameOver") return null;
    return this.bots().some((b) => botAction(state, b.id, b.level) !== null)
      ? now + BOT_DELAY_MS
      : null;
  }

  /** Plays one bot move, the current player's first so turns flow in order. */
  private playBotMove(now: number): void {
    const state = this.game();
    const bots = this.bots();
    const current = state.players[state.turn.playerIndex]?.id;
    const order = [
      ...bots.filter((b) => b.id === current),
      ...bots.filter((b) => b.id !== current),
    ];
    for (const { id, level } of order) {
      const action = botAction(state, id, level);
      if (action) {
        this.commitGame(applyAction(state, id, action), now);
        return;
      }
    }
    this.sql.exec("UPDATE lobby SET bot_due_at = NULL WHERE id = 1");
  }

  private addBot(playerId: string, level: BotLevel): void {
    this.requireHost(playerId);
    this.requireStatus("open");
    const taken = new Set(this.players().map((p) => p.seat));
    const seat = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((i) => !taken.has(i));
    if (seat === undefined) throw new RequestError("lobby_full", "The lobby is full");
    const now = Date.now();
    const id = crypto.randomUUID();
    // Bots never sign in; a random value stands in for the session hash nobody holds.
    this.insertPlayer(id, "Bot", seat, generateToken(), now, "bot");
    const hero = this.players().find((p) => p.id === id)?.hero;
    this.sql.exec(
      "UPDATE players SET name = ?, bot_level = ? WHERE id = ?",
      `Bot · ${hero ? heroName(hero) : seat + 1}`,
      level,
      id,
    );
    this.bumpVersion(now);
    this.broadcast([]);
  }

  private removePlayer(hostId: string, playerId: string): void {
    this.requireHost(hostId);
    this.requireStatus("open");
    if (playerId === hostId) throw new RequestError("rejected", "The host can't remove themselves");
    const removed = this.sql.exec("DELETE FROM players WHERE id = ?", playerId);
    if (removed.rowsWritten === 0) throw new RequestError("not_found", "No such player");
    this.closeSocketsOf(playerId, CloseCode.Removed, "removed by the host");
    this.bumpVersion(Date.now());
    this.broadcast([]);
  }

  /** Changes how well a bot plays, before or during a game. */
  private setBotLevel(hostId: string, playerId: string, level: BotLevel): void {
    this.requireHost(hostId);
    const updated = this.sql.exec(
      "UPDATE players SET bot_level = ? WHERE id = ? AND kind = 'bot'",
      level,
      playerId,
    );
    if (updated.rowsWritten === 0) throw new RequestError("not_found", "No such bot");
    this.bumpVersion(Date.now());
    this.broadcast([]);
  }

  /** Hands a player's seat to a bot mid-game, keeping everything they own in play. */
  private replaceWithBot(hostId: string, playerId: string, level: BotLevel): void {
    this.requireHost(hostId);
    this.requireStatus("playing");
    const target = this.players().find((p) => p.id === playerId);
    if (!target) throw new RequestError("not_found", "No such player");
    if (target.kind === "bot") throw new RequestError("rejected", "That seat is already a bot");
    if (playerId === hostId) throw new RequestError("rejected", "Make someone else host first");

    const now = Date.now();
    this.sql.exec(
      "UPDATE players SET kind = 'bot', bot_level = ?, name = ?, token_hash = ?, seat_code_hash = NULL, seat_code_expires_at = NULL WHERE id = ?",
      level,
      `${target.name} (bot)`,
      generateToken(),
      playerId,
    );
    this.closeSocketsOf(playerId, CloseCode.Removed, "replaced by a bot");

    // Their open offers go with them; the bot answers incoming ones itself.
    let state = this.game();
    const events: GameEvent[] = [];
    for (const trade of state.trades.filter((t) => t.from === playerId)) {
      const result = applyAction(state, playerId, { type: "cancelTrade", tradeId: trade.id });
      if (result.ok) {
        state = result.state;
        events.push(...result.events);
      }
    }
    this.commitGame({ ok: true, state, events }, now);
  }

  /** For the join page. Read-only: an unknown code answers null without creating storage. */
  async info(): Promise<LobbyInfo | null> {
    const lobby = this.lobby();
    if (!lobby) return null;
    return {
      status: lobby.status,
      full: this.players().length >= MAX_PLAYERS,
      locked: lobby.passcode_hash !== null,
    };
  }

  /**
   * What the landing page's "Your games" shows for the seat holding `token`.
   * Read-only: a lobby that doesn't exist answers not_found without creating storage.
   */
  async summary(
    token: string,
  ): Promise<
    { ok: true; summary: LobbySummary } | { ok: false; error: "not_found" | "unauthorized" }
  > {
    const tokenHash = await sha256Hex(token);
    // Read after hashing: the lobby can change, or be deleted, while the hash is computed.
    const lobby = this.lobby();
    if (!lobby) return { ok: false, error: "not_found" };
    const me = this.sql
      .exec<{ id: string; name: string }>(
        "SELECT id, name FROM players WHERE token_hash = ? AND kind = 'human'",
        tokenHash,
      )
      .toArray()[0];
    if (!me) return { ok: false, error: "unauthorized" };
    return {
      ok: true,
      summary: {
        status: lobby.status,
        paused: lobby.paused === 1,
        round: lobby.status === "open" ? null : this.game().turn.round,
        players: this.players().map((p) => ({ name: p.name, bot: p.kind === "bot" })),
        you: me.name,
        isHost: lobby.host_id === me.id,
        lastActiveAt: lobby.last_active_at,
      },
    };
  }

  private setHost(hostId: string, playerId: string): void {
    this.requireHost(hostId);
    const target = this.players().find((p) => p.id === playerId);
    if (!target || target.kind === "bot") {
      throw new RequestError("rejected", "Only a person can host");
    }
    this.sql.exec("UPDATE lobby SET host_id = ?, host_check_at = NULL WHERE id = 1", playerId);
    this.bumpVersion(Date.now());
    this.broadcast([]);
  }

  // ---------- Moving a seat to another device ----------

  private async createSeatCode(ws: WebSocket, playerId: string): Promise<void> {
    const code = generateLobbyCode();
    const hash = await sha256Hex(code);
    const expiresAt = Date.now() + SEAT_CODE_TTL_MS;
    this.sql.exec(
      "UPDATE players SET seat_code_hash = ?, seat_code_expires_at = ? WHERE id = ? AND kind = 'human'",
      hash,
      expiresAt,
      playerId,
    );
    send(ws, { type: "seatCode", code, expiresAt });
  }

  /** Swaps a valid, unexpired seat code for a fresh session; the old device is signed out. */
  async claimSeat(seatCode: string): Promise<JoinResult> {
    const hash = await sha256Hex(seatCode.toUpperCase());
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    const lobby = this.lobby();
    if (!lobby) return { ok: false, error: "not_found", message: "Lobby not found" };
    const now = Date.now();
    const player = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM players WHERE seat_code_hash = ? AND seat_code_expires_at > ? AND kind = 'human'",
        hash,
        now,
      )
      .toArray()[0];
    if (!player) {
      return {
        ok: false,
        error: "unauthorized",
        message: "That seat code is wrong or has expired",
      };
    }
    this.sql.exec(
      "UPDATE players SET token_hash = ?, seat_code_hash = NULL, seat_code_expires_at = NULL WHERE id = ?",
      tokenHash,
      player.id,
    );
    this.closeSocketsOf(player.id, CloseCode.SeatMoved, "seat moved to another device");
    this.touch(now);
    return { ok: true, session: { code: lobby.code, playerId: player.id, token } };
  }

  private closeSocketsOf(playerId: string, code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (attachment(ws).playerId === playerId) safeClose(ws, code, reason);
    }
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
      lobby.status === "playing" && !lobby.paused ? lobby.bot_due_at : null,
      this.listedAs && this.listedAt !== null ? this.listedAt + LISTING_REFRESH_MS : null,
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
                resumed_at, action_deadline, host_check_at, bot_due_at, passcode_hash,
                passcode_failures, passcode_failed_at
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
      .exec<PlayerRow>("SELECT id, name, seat, hero, kind, bot_level FROM players ORDER BY seat")
      .toArray();
  }

  private game(): GameState {
    const row = this.sql
      .exec<{ state_json: string }>("SELECT state_json FROM game WHERE id = 1")
      .toArray()[0];
    if (!row) throw new Error("lobby is playing but has no game row");
    return migrateState(JSON.parse(row.state_json));
  }

  private insertPlayer(
    id: string,
    name: string,
    seat: number,
    tokenHash: string,
    now: number,
    kind: PlayerRow["kind"] = "human",
  ) {
    const taken = new Set(this.players().map((p) => p.hero));
    const hero = HERO_IDS.find((h) => !taken.has(h)) ?? null;
    this.sql.exec(
      "INSERT INTO players (id, name, seat, hero, token_hash, joined_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      name,
      seat,
      hero,
      tokenHash,
      now,
      kind,
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
    const players = this.players().map(({ kind, bot_level, ...p }) => ({
      ...p,
      hero: (HERO_IDS as readonly string[]).includes(p.hero ?? "")
        ? (p.hero as LobbySnapshot["players"][number]["hero"])
        : null,
      connected: connected.has(p.id),
      bot: kind === "bot",
      botLevel: kind === "bot" ? (bot_level ?? "normal") : null,
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
    this.syncListing(closing);
  }

  // ---------- Public listing ----------

  private directory() {
    return this.env.DIRECTORY.getByName("directory");
  }

  /**
   * What this lobby last sent the directory: a listing as JSON, null for "not
   * listed", or undefined when unknown (after a wake-up).
   */
  private listedAs: string | null | undefined = undefined;
  /** When the listing was last sent, so a quiet lobby can refresh it before the directory's TTL. */
  private listedAt: number | null = null;

  /**
   * Lists the lobby while it is public (with or without a passcode), waiting, not
   * full and its host is connected; otherwise takes it down. Calls the directory
   * only on a change, or to refresh a listing older than LISTING_REFRESH_MS.
   */
  private syncListing(closing?: WebSocket): void {
    const lobby = this.lobby();
    if (!lobby) return;
    const settings = parseSettings(lobby.settings_json);
    if (settings.visibility === "private" && !this.listedAs) return;
    const players = this.players();
    const host = players.find((p) => p.id === lobby.host_id);
    const listing: Listing | null =
      settings.visibility !== "private" &&
      lobby.status === "open" &&
      players.length < MAX_PLAYERS &&
      host &&
      this.connectedIds(closing).has(host.id)
        ? {
            code: lobby.code,
            hostName: host.name,
            players: players.length,
            maxPlayers: MAX_PLAYERS,
            mode: settings.mode,
            speedDie: settings.speedDie,
            locked: settings.visibility === "passcode",
          }
        : null;
    const key = listing ? JSON.stringify(listing) : null;
    const now = Date.now();
    const stale = this.listedAt !== null && now - this.listedAt >= LISTING_REFRESH_MS;
    if (key === this.listedAs && !(listing && stale)) return;
    this.listedAs = key;
    this.listedAt = listing ? now : null;
    const sync = listing ? this.directory().upsert(listing) : this.directory().remove(lobby.code);
    this.ctx.waitUntil(
      sync.catch((error: unknown) => {
        console.error("directory sync failed", lobby.code, error);
        // Unknown again, so the next sync retries instead of trusting the failed call.
        if (this.listedAs === key) {
          this.listedAs = "unknown";
          this.listedAt = null;
        }
      }),
    );
  }
}

/** When the current decision will be auto-played: auctions always, other decisions if the host set a timer. */
function actionDeadline(
  state: GameState,
  settings: LobbySettings,
  now: number,
  botIds: string[],
): number | null {
  if (state.phase.kind === "gameOver") return null;
  if (state.phase.kind === "auction") return now + AUCTION_TIMER_SECONDS * 1000;
  // A bot never needs a turn timer: it moves on its own.
  const deciding =
    state.phase.kind === "raisingFunds"
      ? state.debts[0]?.debtor
      : state.players[state.turn.playerIndex]?.id;
  if (deciding && botIds.includes(deciding)) return null;
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
