import type { Action, GameEvent, PublicGameState } from "@richual/engine";
import { HERO_IDS } from "@richual/engine";
import { z } from "zod";

/** Bumped on any breaking change to the wire format; clients on another version must reload. */
export const PROTOCOL_VERSION = 2;

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_PLAYERS = 6;

/** Crockford base32 without I, L, O, U to avoid confusable characters in invite codes. */
export const LOBBY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LOBBY_CODE_LENGTH = 6;
export const LobbyCode = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(new RegExp(`^[${LOBBY_CODE_ALPHABET}]{${LOBBY_CODE_LENGTH}}$`)));

export const PlayerName = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(20, "Name must be at most 20 characters")
  // Control characters would let a name break the layout or spoof log lines.
  .refine((s) => !/\p{Cc}/u.test(s), "Name contains invalid characters");

// ---------- HTTP ----------

export const CreateLobbyRequest = z.object({ name: PlayerName });
export type CreateLobbyRequest = z.infer<typeof CreateLobbyRequest>;

export const JoinLobbyRequest = z.object({ name: PlayerName });
export type JoinLobbyRequest = z.infer<typeof JoinLobbyRequest>;

export const SessionResponse = z.object({
  code: z.string(),
  playerId: z.string(),
  token: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

export const ErrorCode = z.enum([
  "bad_request",
  "not_found",
  "lobby_full",
  "unauthorized",
  "forbidden",
  "protocol_mismatch",
  "game_in_progress",
  /** The client acted on an outdated version; a fresh snapshot follows. */
  "stale",
  /** The game rules refused the action. */
  "rejected",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({ error: ErrorCode, message: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// ---------- Lobby snapshot ----------

export const HeroId = z.enum(HERO_IDS);

export const LobbySettings = z.object({
  startingCash: z.number().int().min(500).max(5000).multipleOf(100).default(1500),
  doubleOnExactGo: z.boolean().default(true),
  freeParkingJackpot: z.boolean().default(true),
});
export type LobbySettings = z.infer<typeof LobbySettings>;

export const LobbyStatus = z.enum(["open", "playing", "finished"]);
export type LobbyStatus = z.infer<typeof LobbyStatus>;

export const LobbyPlayer = z.object({
  id: z.string(),
  name: z.string(),
  seat: z.number().int(),
  hero: HeroId.nullable(),
  connected: z.boolean(),
});
export type LobbyPlayer = z.infer<typeof LobbyPlayer>;

export const LobbySnapshot = z.object({
  code: z.string(),
  hostId: z.string(),
  status: LobbyStatus,
  /** Increments on every persisted change; actions must name the version they were chosen against. */
  version: z.number().int(),
  settings: LobbySettings,
  players: z.array(LobbyPlayer),
  // The game view comes from the authoritative server, so it is typed but not re-validated.
  game: z.custom<PublicGameState>((v) => typeof v === "object").nullable(),
});
export type LobbySnapshot = z.infer<typeof LobbySnapshot>;

// ---------- WebSocket ----------

/** Sent verbatim by clients as a keepalive; answered by the DO without waking it from hibernation. */
export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';

export const GameAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll") }),
  z.object({ type: z.literal("payJailFine") }),
  z.object({ type: z.literal("useGetOutCard") }),
  z.object({ type: z.literal("buy") }),
  z.object({ type: z.literal("decline") }),
  z.object({ type: z.literal("endTurn") }),
]);
// Fails to compile if the schema and the engine's Action type drift apart.
const _actionsMatch: [z.infer<typeof GameAction>, Action] extends [
  Action,
  z.infer<typeof GameAction>,
]
  ? true
  : never = true;

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.number().int(),
    token: z.string().min(1).max(128),
  }),
  z.object({ type: z.literal("setHero"), hero: HeroId }),
  z.object({ type: z.literal("updateSettings"), settings: LobbySettings }),
  z.object({ type: z.literal("startGame") }),
  z.object({ type: z.literal("returnToLobby") }),
  z.object({
    type: z.literal("action"),
    /** Client-generated id; resending the same id never applies the action twice. */
    clientActionId: z.uuid(),
    expectedVersion: z.number().int(),
    action: GameAction,
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), playerId: z.string(), lobby: LobbySnapshot }),
  z.object({
    type: z.literal("lobby"),
    lobby: LobbySnapshot,
    /** What changed, for the event log; empty for presence-only updates. */
    events: z.array(z.custom<GameEvent>((v) => typeof v === "object")),
  }),
  z.object({ type: z.literal("ack"), clientActionId: z.string() }),
  z.object({
    type: z.literal("error"),
    error: ErrorCode,
    message: z.string(),
    clientActionId: z.string().optional(),
  }),
  z.object({ type: z.literal("pong") }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** WebSocket close codes in the 4000–4999 application range. */
export const CloseCode = {
  Unauthorized: 4001,
  ProtocolMismatch: 4002,
  HelloTimeout: 4003,
  LobbyClosed: 4004,
  Replaced: 4005,
} as const;
