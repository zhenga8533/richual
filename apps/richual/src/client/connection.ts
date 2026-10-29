import {
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

type ConnectionState = {
  status: ConnectionStatus;
  playerId: string | null;
  lobby: LobbySnapshot | null;
  error: string | null;
};

export const useConnection = create<ConnectionState>(() => ({
  status: "connecting",
  playerId: null,
  lobby: null,
  error: null,
}));

const KEEPALIVE_MS = 30_000;
const MAX_BACKOFF_MS = 10_000;

const TERMINAL_CLOSES: Record<number, string> = {
  [CloseCode.Unauthorized]: "Your session for this lobby is no longer valid.",
  [CloseCode.ProtocolMismatch]: "A new version of Richual is available. Please reload.",
  [CloseCode.LobbyClosed]: "This lobby has closed.",
  [CloseCode.Replaced]: "This lobby is open in another tab.",
};

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

  useConnection.setState({ status: "connecting", playerId: null, lobby: null, error: null });

  const open = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/api/lobbies/${session.code}/ws`);

    ws.onopen = () => {
      ws?.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, token: session.token }));
      keepalive = setInterval(() => ws?.send(PING), KEEPALIVE_MS);
    };

    ws.onmessage = (event) => {
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
      const msg = parsed.data;
      switch (msg.type) {
        case "welcome":
          attempt = 0;
          useConnection.setState({
            status: "open",
            playerId: msg.playerId,
            lobby: msg.lobby,
            error: null,
          });
          break;
        case "lobby":
          useConnection.setState({ lobby: msg.lobby });
          break;
        case "error":
          useConnection.setState({ error: msg.message });
          break;
        case "pong":
          break;
      }
    };

    ws.onclose = (event) => {
      clearInterval(keepalive);
      if (disposed) return;
      const terminal = TERMINAL_CLOSES[event.code];
      if (terminal) {
        if (event.code === CloseCode.Unauthorized || event.code === CloseCode.LobbyClosed) {
          clearSession(session.code);
        }
        useConnection.setState({ status: "closed", error: terminal });
        return;
      }
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);
      attempt++;
      useConnection.setState({ status: "reconnecting" });
      retryTimer = setTimeout(open, delay);
    };
  };

  open();

  return () => {
    disposed = true;
    clearTimeout(retryTimer);
    clearInterval(keepalive);
    ws?.close(1000, "navigated away");
  };
}
