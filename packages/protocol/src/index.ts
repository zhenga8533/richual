import type { Action, GameEvent, PublicGameState, RuleConfig } from "@richual/engine";
import { HERO_IDS, MODES } from "@richual/engine";
import { z } from "zod";

/** Bumped on any breaking change to the wire format; clients on another version must reload. */
export const PROTOCOL_VERSION = 4;

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
  /** Game actions wait while the host has paused the game. */
  "paused",
  "rate_limited",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({ error: ErrorCode, message: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// ---------- Lobby snapshot ----------

export const HeroId = z.enum(HERO_IDS);

export const TURN_TIMER_OPTIONS: readonly number[] = [0, 30, 60, 90, 120];
/** Auctions always run on a timer, reset by every bid, so one idle bidder cannot stall play. */
export const AUCTION_TIMER_SECONDS = 20;
export const MAX_CHAT_LENGTH = 200;

export const LobbySettings = z.object({
  startingCash: z.number().int().min(500).max(5000).multipleOf(100).default(1500),
  doubleOnExactGo: z.boolean().default(true),
  freeParkingJackpot: z.boolean().default(true),
  auctions: z.boolean().default(true),
  /** Even building plus the bank's limited Guardian and Walker supply. */
  evenBuilding: z.boolean().default(true),
  mode: z.enum(["classic", "quick"]).default("classic"),
  /** When the game is scored if nobody has won outright. */
  limit: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("rounds"), rounds: z.number().int().min(5).max(100) }),
      /** Active play time, excluding pauses; the round in progress is finished. */
      z.object({ kind: z.literal("minutes"), minutes: z.number().int().min(10).max(240) }),
    ])
    .default({ kind: "none" }),
  /** Seconds before an idle decision is auto-played; 0 turns the timer off. */
  turnTimerSeconds: z
    .number()
    .int()
    .refine((n) => TURN_TIMER_OPTIONS.includes(n), "Unsupported turn timer")
    .default(0),
});
export type LobbySettings = z.infer<typeof LobbySettings>;

/** The engine rules a lobby's settings produce: the mode's preset with the host's overrides. */
export function rulesFromSettings(settings: LobbySettings): RuleConfig {
  return {
    ...MODES[settings.mode],
    startingCash: settings.startingCash,
    doubleOnExactGo: settings.doubleOnExactGo,
    freeParkingJackpot: settings.freeParkingJackpot,
    auctions: settings.auctions,
    evenBuilding: settings.evenBuilding,
    limitedBuildings: settings.evenBuilding,
    roundLimit: settings.limit.kind === "rounds" ? settings.limit.rounds : null,
  };
}

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

export const ChatMessage = z.object({
  id: z.number().int(),
  playerId: z.string(),
  text: z.string(),
  at: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

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
  paused: z.boolean(),
  clock: z.object({
    /** Active play time banked before the current stretch. */
    playMs: z.number(),
    /** When the current stretch of active play began; null while paused or not playing. */
    resumedAt: z.number().nullable(),
    limitMs: z.number().nullable(),
  }),
  /** When the current decision will be auto-played, or null if no timer is running. */
  actionDeadline: z.number().nullable(),
  /** Server time when this snapshot was made, so clients can correct for clock skew. */
  serverNow: z.number(),
  chat: z.array(ChatMessage),
});
export type LobbySnapshot = z.infer<typeof LobbySnapshot>;

// ---------- WebSocket ----------

/** Sent verbatim by clients as a keepalive; answered by the DO without waking it from hibernation. */
export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';

const Space = z.number().int().min(0).max(63);
const DeckId = z.enum(["oracle", "coven"]);
const TradeBundle = z.object({
  cash: z.number().int().min(0).max(1_000_000),
  spaces: z.array(Space).max(40),
  getOutCards: z.array(DeckId).max(4),
});

export const GameAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll") }),
  z.object({ type: z.literal("payJailFine") }),
  z.object({ type: z.literal("useGetOutCard") }),
  z.object({ type: z.literal("buy") }),
  z.object({ type: z.literal("decline") }),
  z.object({ type: z.literal("endTurn") }),
  z.object({ type: z.literal("build"), space: Space }),
  z.object({ type: z.literal("sellBuilding"), space: Space }),
  z.object({ type: z.literal("seal"), space: Space }),
  z.object({ type: z.literal("unseal"), space: Space }),
  z.object({ type: z.literal("bid"), amount: z.number().int().min(1).max(1_000_000) }),
  z.object({ type: z.literal("passAuction") }),
  z.object({ type: z.literal("payDebt") }),
  z.object({ type: z.literal("declareBankruptcy") }),
  z.object({
    type: z.literal("proposeTrade"),
    to: z.string().max(64),
    offer: TradeBundle,
    request: TradeBundle,
  }),
  z.object({ type: z.literal("acceptTrade"), tradeId: z.number().int() }),
  z.object({ type: z.literal("rejectTrade"), tradeId: z.number().int() }),
  z.object({ type: z.literal("cancelTrade"), tradeId: z.number().int() }),
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
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("endGame") }),
  z.object({ type: z.literal("chat"), text: z.string().trim().min(1).max(MAX_CHAT_LENGTH) }),
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
