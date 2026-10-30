import { LOBBY_CODE_ALPHABET, LOBBY_CODE_LENGTH } from "@richual/protocol";

export function generateLobbyCode(): string {
  // 256 is a multiple of the 32-character alphabet, so `byte % 32` is unbiased.
  const bytes = crypto.getRandomValues(new Uint8Array(LOBBY_CODE_LENGTH));
  return Array.from(bytes, (b) => LOBBY_CODE_ALPHABET[b % LOBBY_CODE_ALPHABET.length]).join("");
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
