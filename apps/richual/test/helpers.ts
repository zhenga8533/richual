import { exports } from "cloudflare:workers";
import {
  type ClientMessage,
  type LobbySnapshot,
  PROTOCOL_VERSION,
  type ServerMessage,
  type SessionResponse,
} from "@richual/protocol";
import { expect } from "vitest";

export const BASE = "http://richual.test";

export async function post(path: string, body: unknown) {
  return exports.default.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function createLobby(name = "Host"): Promise<SessionResponse> {
  const res = await post("/api/lobbies", { name });
  expect(res.status).toBe(201);
  return res.json();
}

export async function joinLobby(code: string, name: string): Promise<SessionResponse> {
  const res = await post(`/api/lobbies/${code}/join`, { name });
  expect(res.status).toBe(201);
  return res.json();
}

export type TestSocket = {
  ws: WebSocket;
  next: () => Promise<ServerMessage>;
  /** Skips messages until one of the given type arrives. */
  until: <T extends ServerMessage["type"]>(type: T) => Promise<Extract<ServerMessage, { type: T }>>;
  send: (message: ClientMessage) => void;
  closed: Promise<CloseEvent>;
};

export async function openSocket(code: string): Promise<TestSocket> {
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
  const until = async <T extends ServerMessage["type"]>(type: T) => {
    for (;;) {
      const msg = await next();
      if (msg.type === type) return msg as Extract<ServerMessage, { type: T }>;
    }
  };
  return { ws, next, until, send: (m) => ws.send(JSON.stringify(m)), closed };
}

export async function hello(code: string, token: string): Promise<TestSocket> {
  const socket = await openSocket(code);
  socket.send({ type: "hello", protocol: PROTOCOL_VERSION, token });
  return socket;
}

/** Connects a session and waits for its welcome snapshot. */
export async function connect(session: SessionResponse) {
  const socket = await hello(session.code, session.token);
  const welcome = await socket.until("welcome");
  return { socket, lobby: welcome.lobby };
}

export function currentPlayerId(lobby: LobbySnapshot): string {
  const game = lobby.game;
  if (!game) throw new Error("no game in progress");
  const id = game.players[game.turn.playerIndex]?.id;
  if (!id) throw new Error("no current player");
  return id;
}
