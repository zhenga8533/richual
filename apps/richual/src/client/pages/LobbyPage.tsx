import type { SessionResponse } from "@richual/protocol";
import { Check, Link2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { claimSeat, joinLobby } from "../api";
import { GameView } from "../components/GameView";
import { SeatTransfer } from "../components/SeatTransfer";
import { Setup } from "../components/Setup";
import { type ConnectionStatus, connect, useConnection } from "../connection";
import { navigate, seatCodeFromHash } from "../router";
import { loadName, loadSession, saveName, saveSession } from "../session";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { cn } from "../ui/cn";
import { Input, Label } from "../ui/field";

export function LobbyPage({ code }: { code: string }) {
  const [session, setSession] = useState(() => loadSession(code));
  const [seatCode, setSeatCode] = useState(seatCodeFromHash);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (!seatCode) return;
    // The code is single-use; keep it out of history and bookmarks either way.
    history.replaceState(null, "", location.pathname);
    let cancelled = false;
    claimSeat(code, seatCode)
      .then((claimed) => {
        if (cancelled) return;
        saveSession(claimed);
        setSession(claimed);
      })
      .catch((err: unknown) => {
        if (!cancelled) setClaimError(err instanceof Error ? err.message : "Could not move seat");
      })
      .finally(() => {
        if (!cancelled) setSeatCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, seatCode]);

  if (seatCode) {
    return <p className="py-16 text-muted">Moving your seat to this device…</p>;
  }
  if (!session) {
    return (
      <>
        {claimError && (
          <p role="alert" className="mt-8 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {claimError}
          </p>
        )}
        <JoinForm code={code} onJoined={setSession} />
      </>
    );
  }
  return <Lobby key={session.token} session={session} />;
}

function JoinForm({
  code,
  onJoined,
}: {
  code: string;
  onJoined: (session: SessionResponse) => void;
}) {
  const [name, setName] = useState(loadName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await joinLobby(code, name);
      saveName(name.trim());
      saveSession(session);
      onJoined(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join lobby");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full max-w-sm flex-1 flex-col justify-center py-8">
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
          <div>
            <p className="text-sm text-muted">You're invited to</p>
            <h1 className="font-mono text-2xl font-semibold tracking-[0.25em]">{code}</h1>
          </div>
          <Label>
            Your name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              required
              autoComplete="nickname"
            />
          </Label>
          <Button type="submit" variant="primary" size="lg" disabled={busy || !name.trim()}>
            {busy ? "Joining…" : "Join"}
          </Button>
          <Button variant="ghost" onClick={() => navigate("/")}>
            Back
          </Button>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}

function Lobby({ session }: { session: SessionResponse }) {
  const { status, lobby, error } = useConnection();
  const [copied, setCopied] = useState(false);

  useEffect(() => connect(session), [session]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/l/${session.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the code stays visible to share by hand.
    }
  };

  const game = lobby && lobby.status !== "open" ? lobby.game : null;

  return (
    <div className={cn("flex w-full flex-col gap-4", game ? "max-w-7xl" : "max-w-5xl")}>
      {/* In a game the sidebar toolbar shows the code and connection, leaving room for the board. */}
      {!game && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted">Lobby</span>
            <h1 className="font-mono text-xl font-semibold tracking-[0.25em]">{session.code}</h1>
          </div>
          <Button variant="outline" size="sm" onClick={copyInvite}>
            {copied ? <Check /> : <Link2 />}
            {copied ? "Copied!" : "Copy invite link"}
          </Button>
          {status === "open" && <SeatTransfer code={session.code} />}
          <StatusDot status={status} />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {lobby && (game ? <GameView lobby={lobby} game={game} /> : <Setup lobby={lobby} />)}

      {status === "closed" && (
        <Button variant="outline" className="self-start" onClick={() => navigate("/")}>
          Back to start
        </Button>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const { text, color } = {
    connecting: { text: "Connecting…", color: "bg-muted" },
    open: { text: "Connected", color: "bg-emerald-500" },
    reconnecting: { text: "Reconnecting…", color: "bg-accent animate-pulse" },
    closed: { text: "Disconnected", color: "bg-danger" },
  }[status];
  return (
    <p className="ml-auto flex items-center gap-2 text-sm text-muted" aria-live="polite">
      <span className={cn("size-2 rounded-full", color)} aria-hidden />
      {text}
    </p>
  );
}
