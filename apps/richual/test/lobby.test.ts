import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import {
  CloseCode,
  PROTOCOL_VERSION,
  type ServerMessage,
  type SessionResponse,
} from "@richual/protocol";
import { describe, expect, it } from "vitest";
import { IDLE_TTL_MS } from "../src/worker/lobby";

const BASE = "http://richual.test";

async function post(path: string, body: unknown) {
  return exports.default.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createLobby(name = "Host"): Promise<SessionResponse> {
  const res = await post("/api/lobbies", { name });
  expect(res.status).toBe(201);
  return res.json();
}

async function joinLobby(code: string, name: string): Promise<SessionResponse> {
  const res = await post(`/api/lobbies/${code}/join`, { name });
  expect(res.status).toBe(201);
  return res.json();
}

type TestSocket = {
  ws: WebSocket;
  next: () => Promise<ServerMessage>;
  closed: Promise<CloseEvent>;
};

async function openSocket(code: string): Promise<TestSocket> {
  const res = await exports.default.fetch(`${BASE}/api/lobbies/${code}/ws`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("no websocket in response");
  ws.accept();

  const buffered: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else buffered.push(msg);
  });
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));
  const next = () => {
    const msg = buffered.shift();
    return msg ? Promise.resolve(msg) : new Promise<ServerMessage>((r) => waiters.push(r));
  };
  return { ws, next, closed };
}

async function hello(code: string, token: string) {
  const socket = await openSocket(code);
  socket.ws.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, token }));
  return socket;
}

describe("HTTP API", () => {
  it("creates a lobby and returns a host session", async () => {
    const session = await createLobby();
    expect(session.code).toMatch(/^[0-9A-Z]{6}$/);
    expect(session.token.length).toBeGreaterThanOrEqual(43);
  });

  it("rejects invalid names", async () => {
    expect((await post("/api/lobbies", { name: "  " })).status).toBe(400);
    expect((await post("/api/lobbies", { name: "x".repeat(21) })).status).toBe(400);
    expect((await post("/api/lobbies", "not json")).status).toBe(400);
  });

  it("returns 404 for unknown lobbies without creating storage", async () => {
    const res = await post("/api/lobbies/ZZZZZZ/join", { name: "Ghost" });
    expect(res.status).toBe(404);
    const tables = await runInDurableObject(env.LOBBY.getByName("ZZZZZZ"), (_, state) =>
      state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray(),
    );
    expect(tables.filter((t) => !String(t.name).startsWith("_cf"))).toEqual([]);
  });

  it("returns 404 for malformed codes", async () => {
    expect((await post("/api/lobbies/bad!/join", { name: "x" })).status).toBe(404);
  });

  it("fills seats up to six players then refuses", async () => {
    const { code } = await createLobby();
    for (let i = 1; i < 6; i++) await joinLobby(code, `P${i}`);
    const res = await post(`/api/lobbies/${code}/join`, { name: "Seventh" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "lobby_full" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await exports.default.fetch(`${BASE}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});

describe("WebSocket sessions", () => {
  it("welcomes a player with a valid token", async () => {
    const host = await createLobby("Haze");
    const { next, ws } = await hello(host.code, host.token);
    const msg = await next();
    expect(msg).toMatchObject({ type: "welcome", playerId: host.playerId });
    if (msg.type !== "welcome") throw new Error("unreachable");
    expect(msg.lobby.players).toEqual([
      { id: host.playerId, name: "Haze", seat: 0, connected: true },
    ]);
    ws.close();
  });

  it("rejects an invalid token", async () => {
    const { code } = await createLobby();
    const { next, closed } = await hello(code, "not-a-real-token");
    expect(await next()).toMatchObject({ type: "error", error: "unauthorized" });
    expect((await closed).code).toBe(CloseCode.Unauthorized);
  });

  it("rejects a token from a different lobby", async () => {
    const a = await createLobby("A");
    const b = await createLobby("B");
    const { next, closed } = await hello(b.code, a.token);
    expect(await next()).toMatchObject({ type: "error", error: "unauthorized" });
    expect((await closed).code).toBe(CloseCode.Unauthorized);
  });

  it("rejects an outdated protocol version", async () => {
    const host = await createLobby();
    const socket = await openSocket(host.code);
    socket.ws.send(JSON.stringify({ type: "hello", protocol: 0, token: host.token }));
    expect(await socket.next()).toMatchObject({ type: "error", error: "protocol_mismatch" });
    expect((await socket.closed).code).toBe(CloseCode.ProtocolMismatch);
  });

  it("reports malformed messages without closing", async () => {
    const host = await createLobby();
    const socket = await hello(host.code, host.token);
    await socket.next();
    socket.ws.send("{oops");
    expect(await socket.next()).toMatchObject({ type: "error", error: "bad_request" });
    socket.ws.send(JSON.stringify({ type: "unknown" }));
    expect(await socket.next()).toMatchObject({ type: "error", error: "bad_request" });
    socket.ws.close();
  });

  it("broadcasts presence when players connect and disconnect", async () => {
    const host = await createLobby("Host");
    const guest = await joinLobby(host.code, "Guest");

    const hostSocket = await hello(host.code, host.token);
    await hostSocket.next();

    const guestSocket = await hello(host.code, guest.token);
    expect(await guestSocket.next()).toMatchObject({ type: "welcome" });
    const joined = await hostSocket.next();
    expect(joined.type).toBe("lobby");
    if (joined.type !== "lobby") throw new Error("unreachable");
    expect(joined.lobby.players.map((p) => p.connected)).toEqual([true, true]);

    guestSocket.ws.close(1000);
    const left = await hostSocket.next();
    if (left.type !== "lobby") throw new Error(`expected lobby, got ${left.type}`);
    expect(left.lobby.players.find((p) => p.id === guest.playerId)?.connected).toBe(false);
    hostSocket.ws.close();
  });

  it("replaces an older connection for the same seat", async () => {
    const host = await createLobby();
    const first = await hello(host.code, host.token);
    await first.next();
    const second = await hello(host.code, host.token);
    expect(await second.next()).toMatchObject({ type: "welcome" });
    expect((await first.closed).code).toBe(CloseCode.Replaced);
    second.ws.close();
  });

  it("keeps sessions valid after the object is evicted", async () => {
    const host = await createLobby();
    await evictDurableObject(env.LOBBY.getByName(host.code));
    const { next, ws } = await hello(host.code, host.token);
    expect(await next()).toMatchObject({ type: "welcome", playerId: host.playerId });
    ws.close();
  });
});

describe("idle cleanup", () => {
  it("schedules an alarm on creation", async () => {
    const host = await createLobby();
    const alarm = await runInDurableObject(env.LOBBY.getByName(host.code), (_, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBeGreaterThan(Date.now() + IDLE_TTL_MS - 60_000);
  });

  it("reschedules while the lobby is still active", async () => {
    const host = await createLobby();
    const stub = env.LOBBY.getByName(host.code);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const alarm = await runInDurableObject(stub, (_, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect((await post(`/api/lobbies/${host.code}/join`, { name: "Still here" })).status).toBe(201);
  });

  it("deletes the lobby after the idle TTL", async () => {
    const host = await createLobby();
    const stub = env.LOBBY.getByName(host.code);
    await runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec("UPDATE lobby SET last_active_at = ?", Date.now() - IDLE_TTL_MS - 1);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await post(`/api/lobbies/${host.code}/join`, { name: "Late" })).status).toBe(404);
  });
});
