import type {
  ErrorResponse,
  LobbyInfo,
  PublicLobbiesResponse,
  SessionResponse,
  SummariesResponse,
} from "@richual/protocol";
import {
  isErrorResponse,
  isLobbyInfo,
  isPublicLobbiesResponse,
  isSessionResponse,
  isSummariesResponse,
} from "./wire";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorResponse["error"],
    message: string,
  ) {
    super(message);
  }
}

/** The body of a successful response, or an ApiError carrying the server's message. */
async function read<T>(res: Response, guard: (value: unknown) => value is T): Promise<T> {
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorResponse(json)) throw new ApiError(json.error, json.message);
    throw new ApiError("internal", `Request failed (${res.status})`);
  }
  if (!guard(json)) throw new ApiError("internal", "Unexpected response from server");
  return json;
}

const postJson = (path: string, body: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const post = async (path: string, body: unknown): Promise<SessionResponse> =>
  read(await postJson(path, body), isSessionResponse);

export const createLobby = (name: string) => post("/api/lobbies", { name });

export const joinLobby = (code: string, name: string, passcode?: string) =>
  post(`/api/lobbies/${encodeURIComponent(code)}/join`, { name, passcode });

export const claimSeat = (code: string, seatCode: string) =>
  post(`/api/lobbies/${encodeURIComponent(code)}/claim`, { seatCode });

/** Status of each saved seat, for "Your games". */
export async function fetchSummaries(sessions: SessionResponse[]): Promise<SummariesResponse> {
  const body = { sessions: sessions.map(({ code, token }) => ({ code, token })) };
  return read(await postJson("/api/lobbies/summaries", body), isSummariesResponse);
}

/** Public lobbies waiting for players, newest first. */
export async function fetchPublicLobbies(): Promise<PublicLobbiesResponse> {
  return read(await fetch("/api/lobbies/public"), isPublicLobbiesResponse);
}

/** Whether a lobby exists and can be joined; null when the code doesn't (or no longer) exist. */
export async function fetchLobbyInfo(code: string): Promise<LobbyInfo | null> {
  const res = await fetch(`/api/lobbies/${encodeURIComponent(code)}`);
  if (res.status === 404) return null;
  return read(res, isLobbyInfo);
}
