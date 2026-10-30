import { useSyncExternalStore } from "react";

// The app has two routes, so a dependency-free pushState router is enough.

const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const lobbyPath = (code: string) => `/l/${code}`;

// A seat code rides in the fragment, which browsers never send to the server or its logs.
const SEAT_PREFIX = "#seat=";

export const seatHash = (seatCode: string) => `${SEAT_PREFIX}${seatCode.toUpperCase()}`;

export function seatCodeFromHash(): string | null {
  return location.hash.startsWith(SEAT_PREFIX)
    ? location.hash.slice(SEAT_PREFIX.length).toUpperCase() || null
    : null;
}

export function matchLobbyPath(pathname: string): string | null {
  return /^\/l\/([^/]+)\/?$/.exec(pathname)?.[1]?.toUpperCase() ?? null;
}
