import type { ErrorResponse, SessionResponse } from "@richual/protocol";
import { isErrorResponse, isSessionResponse } from "./wire";

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

export const joinLobby = (code: string, name: string) =>
  post(`/api/lobbies/${encodeURIComponent(code)}/join`, { name });

export const claimSeat = (code: string, seatCode: string) =>
  post(`/api/lobbies/${encodeURIComponent(code)}/claim`, { seatCode });
