import { ErrorResponse, SessionResponse } from "@richual/protocol";

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
    const err = ErrorResponse.safeParse(json);
    if (err.success) throw new ApiError(err.data.error, err.data.message);
    throw new ApiError("internal", `Request failed (${res.status})`);
  }
  return SessionResponse.parse(json);
}

export const createLobby = (name: string) => post("/api/lobbies", { name });

export const joinLobby = (code: string, name: string) =>
  post(`/api/lobbies/${encodeURIComponent(code)}/join`, { name });
