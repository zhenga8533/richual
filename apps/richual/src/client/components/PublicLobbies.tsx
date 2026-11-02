import type { PublicLobby } from "@richual/protocol";
import { Lock, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchPublicLobbies } from "../api";
import { lobbyPath, navigate } from "../router";
import { Button } from "../ui/button";

/** Public lobbies waiting for players. Loads when shown and on Refresh; never polls. */
export function PublicLobbies() {
  const [lobbies, setLobbies] = useState<PublicLobby[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLobbies((await fetchPublicLobbies()).lobbies);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load public lobbies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-2 p-3 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Lobbies waiting for players</p>
        <Button
          variant="ghost"
          size="sm"
          className="px-2"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh public lobbies"
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {lobbies && lobbies.length === 0 && !error && (
        <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-sm text-muted">
          No public lobbies right now. Create one and set “Who can join” to Public.
        </p>
      )}
      {lobbies && lobbies.length > 0 && (
        <ul aria-label="Public lobbies" className="flex flex-col">
          {lobbies.map((l) => (
            <li
              key={l.code}
              className="flex items-center gap-3 border-b border-line py-2 last:border-0"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{l.hostName}'s lobby</span>
                  {l.locked && (
                    <Lock className="size-3.5 shrink-0 text-muted" aria-label="Needs a passcode" />
                  )}
                </span>
                <span className="text-xs text-muted">
                  {l.players}/{l.maxPlayers} players · {l.mode === "quick" ? "Quick" : "Classic"}
                  {l.speedDie ? " · Speed Die" : ""}
                </span>
              </span>
              <Button size="sm" variant="primary" onClick={() => navigate(lobbyPath(l.code))}>
                Join
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
