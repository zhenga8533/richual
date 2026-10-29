import type { SessionResponse } from "@richual/protocol";
import { type FormEvent, useEffect, useState } from "react";
import { joinLobby } from "../api";
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
  const { status, lobby, playerId, error } = useConnection();
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

  return (
    <div className="flex w-full max-w-lg flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-parchment-dim">Lobby</p>
          <h1 className="font-mono text-4xl tracking-[0.3em] text-brass">{session.code}</h1>
        </div>
        <button type="button" className="btn-ghost text-sm" onClick={copyInvite}>
          {copied ? "Copied!" : "Copy invite link"}
        </button>
      </header>

      <StatusLine status={status} />
      {error && (
        <p role="alert" className="text-sm text-blood">
          {error}
        </p>
      )}

      {lobby && (
        <section className="panel p-5" aria-labelledby="players-heading">
          <h2 id="players-heading" className="mb-3 font-display text-xl">
            Players ({lobby.players.length}/6)
          </h2>
          <ul className="flex flex-col gap-2">
            {lobby.players.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span
                  className={`size-2.5 rounded-full ${p.connected ? "bg-amber" : "bg-smoke-light"}`}
                  role="img"
                  aria-label={p.connected ? "online" : "offline"}
                />
                <span className={p.id === playerId ? "font-semibold" : ""}>{p.name}</span>
                {p.id === lobby.hostId && (
                  <span className="rounded-sm border border-brass-dim px-1.5 text-xs text-brass">
                    Host
                  </span>
                )}
                {p.id === playerId && <span className="text-xs text-parchment-dim">(you)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-parchment-dim">
            Starting a game isn't available yet — this build only covers lobbies.
          </p>
        </section>
      )}

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
    <p className="text-sm text-parchment-dim" aria-live="polite">
      {text}
    </p>
  );
}
