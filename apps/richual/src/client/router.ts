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

export function matchLobbyPath(pathname: string): string | null {
  return /^\/l\/([^/]+)\/?$/.exec(pathname)?.[1]?.toUpperCase() ?? null;
}
