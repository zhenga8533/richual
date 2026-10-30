import type { Action, GameEvent } from "@richual/engine";
import {
  type ClientMessage,
  CloseCode,
  type LobbySnapshot,
  PING,
  PROTOCOL_VERSION,
  ServerMessage,
  type SessionResponse,
} from "@richual/protocol";
import { create } from "zustand";
import { clearSession } from "./session";

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  /** Terminal: the server refused or closed this seat; no automatic retry. */
  | "closed";

export type LoggedEvent = { seq: number; event: GameEvent };

type ConnectionState = {
  status: ConnectionStatus;
  playerId: string | null;
  lobby: LobbySnapshot | null;
  /** Fatal connection problem, shown in place of the lobby. */
  error: string | null;
  /** Transient message about a refused request. */
  notice: string | null;
  log: LoggedEvent[];
  /** Id of the action awaiting acknowledgement; further actions wait for it. */
  pendingActionId: string | null;
  /** Server clock minus local clock, so deadlines display correctly on skewed machines. */
  clockOffset: number;
};

export const useConnection = create<ConnectionState>(() => ({
  status: "connecting",
  playerId: null,
  lobby: null,
  error: null,
  notice: null,
  log: [],
  pendingActionId: null,
  clockOffset: 0,
}));

/** The current time on the server's clock. */
export const serverNow = () => Date.now() + useConnection.getState().clockOffset;

const KEEPALIVE_MS = 30_000;
const MAX_BACKOFF_MS = 10_000;
const MAX_LOG = 200;
const NOTICE_MS = 4_000;

const TERMINAL_CLOSES: Record<number, string> = {
  [CloseCode.Unauthorized]: "Your session for this lobby is no longer valid.",
  [CloseCode.ProtocolMismatch]: "A new version of Richual is available. Please reload.",
  [CloseCode.LobbyClosed]: "This lobby has closed.",
  [CloseCode.Replaced]: "This lobby is open in another tab.",
};

let activeSocket: WebSocket | null = null;
let logSeq = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function showNotice(message: string): void {
  clearTimeout(noticeTimer);
  useConnection.setState({ notice: message });
  noticeTimer = setTimeout(() => useConnection.setState({ notice: null }), NOTICE_MS);
}

/** Sends a message if connected. Returns false when there is no open connection. */
export function send(message: ClientMessage): boolean {
  if (activeSocket?.readyState !== WebSocket.OPEN) {
    showNotice("Not connected. Reconnecting…");
    return false;
  }
  activeSocket.send(JSON.stringify(message));
  return true;
}

export function sendAction(action: Action): void {
  const { lobby, pendingActionId } = useConnection.getState();
  if (!lobby || pendingActionId) return;
  const clientActionId = crypto.randomUUID();
  const sent = send({ type: "action", clientActionId, expectedVersion: lobby.version, action });
  if (sent) useConnection.setState({ pendingActionId: clientActionId });
}

function appendEvents(events: GameEvent[]): LoggedEvent[] {
  const log = useConnection.getState().log;
  if (events.length === 0) return log;
  const added = events.map((event) => ({ seq: ++logSeq, event }));
  return [...log, ...added].slice(-MAX_LOG);
}

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "welcome":
      useConnection.setState({
        status: "open",
        playerId: msg.playerId,
        lobby: msg.lobby,
        // The server's recent history replaces whatever this tab had, so a reload loses nothing.
        log: msg.events.map((event) => ({ seq: ++logSeq, event })).slice(-MAX_LOG),
        clockOffset: msg.lobby.serverNow - Date.now(),
        error: null,
        // Anything in flight before a reconnect is reflected in this snapshot.
        pendingActionId: null,
      });
      break;
    case "lobby":
      useConnection.setState({
        lobby: msg.lobby,
        log: appendEvents(msg.events),
        clockOffset: msg.lobby.serverNow - Date.now(),
      });
      break;
    case "ack":
      if (useConnection.getState().pendingActionId === msg.clientActionId) {
        useConnection.setState({ pendingActionId: null });
      }
      break;
    case "error":
      if (msg.clientActionId && useConnection.getState().pendingActionId === msg.clientActionId) {
        useConnection.setState({ pendingActionId: null });
      }
      // A stale action is resolved by the snapshot that follows; nothing for the player to do.
      if (msg.error !== "stale") showNotice(msg.message);
      break;
    case "pong":
      break;
  }
}

/**
 * Keeps one WebSocket open to the lobby, re-authenticating and resyncing after
 * every reconnect. Returns a disposer.
 */
export function connect(session: SessionResponse): () => void {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  useConnection.setState({
    status: "connecting",
    playerId: null,
    lobby: null,
    error: null,
    notice: null,
    log: [],
    pendingActionId: null,
  });

  const open = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/api/lobbies/${session.code}/ws`);
    ws = socket;
    activeSocket = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, token: session.token }),
      );
      keepalive = setInterval(() => socket.send(PING), KEEPALIVE_MS);
    };

    socket.onmessage = (event) => {
      let json: unknown;
      try {
        json = JSON.parse(String(event.data));
      } catch {
        json = null;
      }
      const parsed = ServerMessage.safeParse(json);
      if (!parsed.success) {
        console.warn("ignoring unrecognized server message", event.data);
        return;
      }
      if (parsed.data.type === "welcome") attempt = 0;
      handleMessage(parsed.data);
    };

    socket.onclose = (event) => {
      clearInterval(keepalive);
      if (activeSocket === socket) activeSocket = null;
      if (disposed) return;
      const terminal = TERMINAL_CLOSES[event.code];
      if (terminal) {
        if (event.code === CloseCode.Unauthorized || event.code === CloseCode.LobbyClosed) {
          clearSession(session.code);
        }
        useConnection.setState({ status: "closed", error: terminal, pendingActionId: null });
        return;
      }
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);
      attempt++;
      useConnection.setState({ status: "reconnecting", pendingActionId: null });
      retryTimer = setTimeout(open, delay);
    };
  };

  open();

  return () => {
    disposed = true;
    clearTimeout(retryTimer);
    clearInterval(keepalive);
    if (ws && activeSocket === ws) activeSocket = null;
    ws?.close(1000, "navigated away");
  };
}
