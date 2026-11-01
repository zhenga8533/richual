import type { SessionResponse } from "@richual/protocol";
import { isSessionResponse } from "./wire";

const PREFIX = "richual:session:";
const key = (code: string) => `${PREFIX}${code}`;
const NAME_KEY = "richual:name";

// Storage can throw in private windows or with site data blocked; the game must still work.

export function loadSession(code: string): SessionResponse | null {
  try {
    const raw = localStorage.getItem(key(code));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSessionResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionResponse): void {
  try {
    localStorage.setItem(key(session.code), JSON.stringify(session));
  } catch (error) {
    console.warn("could not persist session; reconnect after reload will not work", error);
  }
}

/** Every seat this browser holds, one per lobby. */
export function listSessions(): SessionResponse[] {
  try {
    const sessions: SessionResponse[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name?.startsWith(PREFIX)) continue;
      const session = loadSession(name.slice(PREFIX.length));
      if (session) sessions.push(session);
    }
    return sessions;
  } catch {
    return [];
  }
}

export function clearSession(code: string): void {
  try {
    localStorage.removeItem(key(code));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Remembering the name is only a convenience.
  }
}
