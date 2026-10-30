import type { SessionResponse } from "@richual/protocol";
import { type FormEvent, useEffect, useState } from "react";
import { joinLobby } from "../api";
import { GameView } from "../components/GameView";
import { Setup } from "../components/Setup";
import { connect, useConnection } from "../connection";
import { navigate } from "../router";
import { loadName, loadSession, saveName, saveSession } from "../session";

export function LobbyPage({ code }: { code: string }) {
  const [session, setSession] = useState(() => loadSession(code));

  if (!session) return <JoinForm code={code} onJoined={setSession} />;
  return <Lobby session={session} />;
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
    <form onSubmit={onSubmit} className="panel flex w-full max-w-md flex-col gap-3 p-5">
      <h1 className="font-display text-2xl text-brass">
        Join lobby <span className="font-mono tracking-widest">{code}</span>
      </h1>
      <label className="flex flex-col gap-1 text-sm">
        Your name
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          required
          autoComplete="nickname"
        />
      </label>
      <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
        {busy ? "Joining…" : "Join"}
      </button>
      <button type="button" className="btn-ghost" onClick={() => navigate("/")}>
        Back
      </button>
      {error && (
        <p role="alert" className="text-sm text-blood">
          {error}
        </p>
      )}
    </form>
  );
}

function Lobby({ session }: { session: SessionResponse }) {
  const { status, lobby, error, notice } = useConnection();
  const [copied, setCopied] = useState(false);

  useEffect(() => connect(session), [session]);

  const inviteUrl = `${location.origin}/l/${session.code}`;
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the link stays visible to copy by hand.
    }
  };

  const game = lobby && lobby.status !== "open" ? lobby.game : null;

  return (
    <div className={`flex w-full flex-col gap-4 ${game ? "max-w-7xl" : "max-w-lg"}`}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-parchment-dim">Lobby</p>
          <h1 className="font-mono text-3xl tracking-[0.3em] text-brass">{session.code}</h1>
        </div>
        <div className="flex items-center gap-4">
          <StatusLine status={status} />
          <button type="button" className="btn-ghost text-sm" onClick={copyInvite}>
            {copied ? "Copied!" : "Copy invite link"}
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="text-sm text-blood">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="panel px-3 py-2 text-sm text-amber">
          {notice}
        </p>
      )}

      {lobby && (game ? <GameView lobby={lobby} game={game} /> : <Setup lobby={lobby} />)}

      {status === "closed" && (
        <button type="button" className="btn-ghost self-start" onClick={() => navigate("/")}>
          Back to start
        </button>
      )}
    </div>
  );
}

function StatusLine({ status }: { status: ReturnType<typeof useConnection.getState>["status"] }) {
  const text = {
    connecting: "Connecting…",
    open: "Connected",
    reconnecting: "Connection lost — reconnecting…",
    closed: "Disconnected",
  }[status];
  return (
    <p className="text-xs text-parchment-dim" aria-live="polite">
      {text}
    </p>
  );
}
