import type {
  ErrorResponse,
  LobbyInfo,
  PublicLobbiesResponse,
  PublicLobby,
  SessionResponse,
  SummariesResponse,
  SummaryResult,
} from "@richual/protocol";

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

const isSummaryResult = (value: unknown): value is SummaryResult =>
  isRecord(value) &&
  typeof value.code === "string" &&
  (value.ok === true
    ? isRecord(value.summary) &&
      typeof value.summary.status === "string" &&
      Array.isArray(value.summary.players) &&
      typeof value.summary.you === "string" &&
      typeof value.summary.lastActiveAt === "number"
    : typeof value.error === "string");

export const isSummariesResponse = (value: unknown): value is SummariesResponse =>
  isRecord(value) && Array.isArray(value.results) && value.results.every(isSummaryResult);

const isPublicLobby = (value: unknown): value is PublicLobby =>
  isRecord(value) &&
  typeof value.code === "string" &&
  typeof value.hostName === "string" &&
  typeof value.players === "number" &&
  typeof value.maxPlayers === "number" &&
  typeof value.mode === "string" &&
  typeof value.speedDie === "boolean" &&
  typeof value.locked === "boolean";

export const isPublicLobbiesResponse = (value: unknown): value is PublicLobbiesResponse =>
  isRecord(value) && Array.isArray(value.lobbies) && value.lobbies.every(isPublicLobby);

export const isLobbyInfo = (value: unknown): value is LobbyInfo =>
  isRecord(value) &&
  typeof value.status === "string" &&
  typeof value.full === "boolean" &&
  typeof value.locked === "boolean";
