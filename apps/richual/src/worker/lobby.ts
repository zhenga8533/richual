import { DurableObject } from "cloudflare:workers";
import {
  ClientMessage,
  CloseCode,
  type ErrorCode,
  type LobbySnapshot,
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

type LobbyRow = { code: string; host_id: string; last_active_at: number };
type PlayerRow = { id: string; name: string; seat: number };

export type JoinResult =
  | { ok: true; session: SessionResponse }
  | { ok: false; error: ErrorCode; message: string };

/**
 * One instance per lobby, addressed by invite code. Owns the lobby's players,
 * sessions and sockets. WebSockets use the Hibernation API so an idle lobby
 * costs nothing while its connections stay open.
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

    const taken = new Set(this.players().map((p) => p.seat));
    const seat = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((i) => !taken.has(i));
    if (seat === undefined) return { ok: false, error: "lobby_full", message: "Lobby is full" };

    const playerId = crypto.randomUUID();
    const now = Date.now();
    this.insertPlayer(playerId, name, seat, tokenHash, now);
    this.touch(now);
    this.broadcastLobby();
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
    switch (msg.type) {
      case "hello":
        await this.handleHello(ws, msg.protocol, msg.token);
        return;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    safeClose(ws, code, reason);
    this.broadcastLobby(ws);
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("lobby websocket error", error);
    this.broadcastLobby(ws);
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
    this.broadcastLobby(undefined, ws);
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private lobby(): LobbyRow | undefined {
    if (!isInitialized(this.sql)) return undefined;
    return this.sql
      .exec<LobbyRow>("SELECT code, host_id, last_active_at FROM lobby WHERE id = 1")
      .toArray()[0];
  }

  private players(): PlayerRow[] {
    return this.sql.exec<PlayerRow>("SELECT id, name, seat FROM players ORDER BY seat").toArray();
  }

  private insertPlayer(id: string, name: string, seat: number, tokenHash: string, now: number) {
    this.sql.exec(
      "INSERT INTO players (id, name, seat, token_hash, joined_at) VALUES (?, ?, ?, ?, ?)",
      id,
      name,
      seat,
      tokenHash,
      now,
    );
  }

  private touch(now: number): void {
    this.sql.exec("UPDATE lobby SET last_active_at = ? WHERE id = 1", now);
  }

  /** @param closing a socket that is closing and must not count as connected */
  private snapshot(closing?: WebSocket): LobbySnapshot {
    const lobby = this.lobby();
    if (!lobby) throw new Error("snapshot of uninitialized lobby");
    const connected = new Set(
      this.ctx
        .getWebSockets()
        .filter((ws) => ws !== closing && ws.readyState === WebSocket.OPEN)
        .map((ws) => attachment(ws).playerId),
    );
    return {
      code: lobby.code,
      hostId: lobby.host_id,
      players: this.players().map((p) => ({ ...p, connected: connected.has(p.id) })),
    };
  }

  private broadcastLobby(closing?: WebSocket, skip?: WebSocket): void {
    if (!this.lobby()) return;
    const message: ServerMessage = { type: "lobby", lobby: this.snapshot(closing) };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing || ws === skip || attachment(ws).playerId === null) continue;
      send(ws, message);
    }
  }
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
