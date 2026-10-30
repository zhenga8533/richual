import { SessionResponse } from "@richual/protocol";

const key = (code: string) => `richual:session:${code}`;
const NAME_KEY = "richual:name";

// Storage can throw in private windows or with site data blocked; the game must still work.

export function loadSession(code: string): SessionResponse | null {
  try {
    const raw = localStorage.getItem(key(code));
    if (!raw) return null;
    const parsed = SessionResponse.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
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
