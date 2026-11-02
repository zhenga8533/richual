import type { LobbySummary, SummaryResult } from "@richual/protocol";
import { MAX_SUMMARIES } from "@richual/protocol/constants";
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, closeLobby, fetchSummaries } from "../api";
import { lobbyPath, navigate } from "../router";
import { clearSession, listSessions, loadSession } from "../session";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

type Row = { code: string; summary: LobbySummary | null };

function statusText(summary: LobbySummary): string {
  if (summary.status === "open") return "Waiting for players";
  if (summary.status === "finished") return "Finished";
  return `${summary.paused ? "Paused · " : ""}Round ${summary.round ?? 1}`;
}

/** Lobbies this browser has a seat in, so a forgotten code is never a lost game. */
export function YourGames() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessions = listSessions().slice(0, MAX_SUMMARIES);
    if (sessions.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    fetchSummaries(sessions)
      .then(({ results }) => {
        if (cancelled) return;
        setRows(toRows(results));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("could not load your games", err);
        setError("Couldn't check your games just now.");
        setRows(sessions.map((s) => ({ code: s.code, summary: null })));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  const forget = (code: string) => {
    clearSession(code);
    setRows((current) => current?.filter((r) => r.code !== code) ?? null);
  };

  return (
    <Card className="flex flex-col gap-1 p-3">
      <h2 id="your-games-heading" className="px-1 pb-1 text-sm font-semibold">
        Your games
      </h2>
      <ul aria-labelledby="your-games-heading" className="flex flex-col">
        {rows.map((row) => (
          <GameRow key={row.code} {...row} onGone={() => forget(row.code)} />
        ))}
      </ul>
      {error && <p className="px-1 text-xs text-muted">{error}</p>}
    </Card>
  );
}

/** One saved seat. `onGone` drops it from this device once it can't be played any more. */
function GameRow({ code, summary, onGone }: Row & { onGone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const close = async () => {
    const session = loadSession(code);
    if (!session) return onGone();
    setClosing(true);
    setCloseError(null);
    try {
      await closeLobby(code, session.token);
      onGone();
    } catch (err) {
      // Either way the seat is gone, which is what closing was for.
      if (err instanceof ApiError && (err.code === "not_found" || err.code === "unauthorized")) {
        onGone();
        return;
      }
      setCloseError(err instanceof Error ? err.message : "Couldn't close the lobby");
      setClosing(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 border-b border-line px-1 py-2 last:border-0">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold tracking-[0.15em]">{code}</span>
            <span className="truncate text-xs text-muted">
              {summary ? statusText(summary) : "Status unavailable"}
            </span>
          </span>
          {summary && (
            <span className="truncate text-xs text-muted">
              {summary.isHost ? "Hosting · " : ""}
              {summary.players.map((p) => p.name).join(", ")}
            </span>
          )}
        </span>
        <Button
          size="sm"
          variant="primary"
          aria-label={`Rejoin ${code}`}
          onClick={() => navigate(lobbyPath(code))}
        >
          Rejoin
        </Button>
        {summary?.isHost && (
          <Button
            size="sm"
            variant="ghost"
            className="px-2"
            aria-label={`Close ${code} for everyone`}
            aria-expanded={confirming}
            title="Close this lobby for everyone"
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="px-2"
          aria-label={`Forget ${code}`}
          title="Forget this game on this device (you stay in it)"
          onClick={onGone}
        >
          <X />
        </Button>
      </div>
      {confirming && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
          <p className="text-sm">Close {code} for everyone? The game and its code are deleted.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="danger" size="sm" disabled={closing} onClick={() => void close()}>
              {closing ? "Closing…" : "Close for everyone"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={closing}
              onClick={() => {
                setConfirming(false);
                setCloseError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {closeError && (
            <p role="alert" className="text-sm text-danger">
              {closeError}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Drops seats that are gone for good; keeps the rest, most recently active first. */
function toRows(results: SummaryResult[]): Row[] {
  const rows: Row[] = [];
  for (const result of results) {
    if (result.ok) rows.push({ code: result.code, summary: result.summary });
    else if (result.error === "unavailable") rows.push({ code: result.code, summary: null });
    else clearSession(result.code);
  }
  return rows.sort((a, b) => (b.summary?.lastActiveAt ?? 0) - (a.summary?.lastActiveAt ?? 0));
}
