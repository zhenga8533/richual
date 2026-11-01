// Dependency-free pieces of the protocol, so the landing page can use them without
// loading Zod or the engine.

/** Bumped on any breaking change to the wire format; clients on another version must reload. */
export const PROTOCOL_VERSION = 6;

/** Crockford base32 without I, L, O, U to avoid confusable characters in invite codes. */
export const LOBBY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LOBBY_CODE_LENGTH = 6;
export const LOBBY_CODE_PATTERN = new RegExp(`^[${LOBBY_CODE_ALPHABET}]{${LOBBY_CODE_LENGTH}}$`);

/** The code in canonical upper case, or null if it isn't a lobby (or seat) code. */
export function normalizeCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return LOBBY_CODE_PATTERN.test(code) ? code : null;
}
