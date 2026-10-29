import { z } from "zod";

/** Bumped on any breaking change to the wire format; clients on another version must reload. */
export const PROTOCOL_VERSION = 1;

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
  "protocol_mismatch",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({ error: ErrorCode, message: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// ---------- Lobby snapshot ----------

export const LobbyPlayer = z.object({
  id: z.string(),
  name: z.string(),
  seat: z.number().int(),
  connected: z.boolean(),
});
export type LobbyPlayer = z.infer<typeof LobbyPlayer>;

export const LobbySnapshot = z.object({
  code: z.string(),
  hostId: z.string(),
  players: z.array(LobbyPlayer),
});
export type LobbySnapshot = z.infer<typeof LobbySnapshot>;

// ---------- WebSocket ----------

/** Sent verbatim by clients as a keepalive; answered by the DO without waking it from hibernation. */
export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.number().int(),
    token: z.string().min(1).max(128),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), playerId: z.string(), lobby: LobbySnapshot }),
  z.object({ type: z.literal("lobby"), lobby: LobbySnapshot }),
  z.object({ type: z.literal("error"), error: ErrorCode, message: z.string() }),
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
