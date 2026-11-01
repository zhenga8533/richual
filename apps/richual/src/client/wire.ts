import type { ErrorResponse, SessionResponse } from "@richual/protocol";

// Hand-written checks for the few responses the landing page reads, so it doesn't
// have to load Zod. Lobby and game messages are still validated with the protocol schemas.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isSessionResponse = (value: unknown): value is SessionResponse =>
  isRecord(value) &&
  typeof value.code === "string" &&
  typeof value.playerId === "string" &&
  typeof value.token === "string";

/** Unknown error codes still pass, so a newer server's message is shown rather than lost. */
export const isErrorResponse = (value: unknown): value is ErrorResponse =>
  isRecord(value) && typeof value.error === "string" && typeof value.message === "string";
