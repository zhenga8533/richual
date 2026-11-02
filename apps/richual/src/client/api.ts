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

async function post(path: string, body: unknown): Promise<SessionResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorResponse(json)) throw new ApiError(json.error, json.message);
    throw new ApiError("internal", `Request failed (${res.status})`);
  }
  if (!isSessionResponse(json)) throw new ApiError("internal", "Unexpected response from server");
  return json;
}

export const createLobby = (name: string) => post("/api/lobbies", { name });

export const joinLobby = (code: string, name: string, passcode?: string) =>
  post(`/api/lobbies/${encodeURIComponent(code)}/join`, { name, passcode });

export const claimSeat = (code: string, seatCode: string) =>
  post(`/api/lobbies/${encodeURIComponent(code)}/claim`, { seatCode });

/** Status of each saved seat, for "Your games". */
export async function fetchSummaries(sessions: SessionResponse[]): Promise<SummariesResponse> {
  const res = await fetch("/api/lobbies/summaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessions: sessions.map(({ code, token }) => ({ code, token })) }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorResponse(json)) throw new ApiError(json.error, json.message);
    throw new ApiError("internal", `Request failed (${res.status})`);
  }
  if (!isSummariesResponse(json)) throw new ApiError("internal", "Unexpected response from server");
  return json;
}

/** Public lobbies waiting for players, newest first. */
export async function fetchPublicLobbies(): Promise<PublicLobbiesResponse> {
  const res = await fetch("/api/lobbies/public");
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorResponse(json)) throw new ApiError(json.error, json.message);
    throw new ApiError("internal", `Request failed (${res.status})`);
  }
  if (!isPublicLobbiesResponse(json)) {
    throw new ApiError("internal", "Unexpected response from server");
  }
  return json;
}

/** Whether a lobby exists and can be joined; null when the code doesn't (or no longer) exist. */
export async function fetchLobbyInfo(code: string): Promise<LobbyInfo | null> {
  const res = await fetch(`/api/lobbies/${encodeURIComponent(code)}`);
  const json: unknown = await res.json().catch(() => null);
  if (res.status === 404) return null;
  if (!res.ok) {
    if (isErrorResponse(json)) throw new ApiError(json.error, json.message);
    throw new ApiError("internal", `Request failed (${res.status})`);
  }
  if (!isLobbyInfo(json)) throw new ApiError("internal", "Unexpected response from server");
  return json;
}
