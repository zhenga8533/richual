import { LobbyCode } from "@richual/protocol";
import { type FormEvent, useState } from "react";
import { createLobby } from "../api";
import { lobbyPath, navigate } from "../router";
import { loadName, saveName, saveSession } from "../session";

export function Landing() {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await createLobby(name);
      saveName(name.trim());
      saveSession(session);
      navigate(lobbyPath(session.code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create lobby");
    } finally {
      setBusy(false);
    }
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    const parsed = LobbyCode.safeParse(code.trim());
    if (!parsed.success) {
      setError("Invite codes are 6 letters or digits.");
      return;
    }
    navigate(lobbyPath(parsed.data));
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-8">
      <header className="text-center">
        <h1 className="font-display text-6xl tracking-wide text-brass">Richual</h1>
        <p className="mt-2 text-parchment-dim">
          Trade souls across the Cursed Apple while the Patrons wait.
        </p>
      </header>

      <form onSubmit={onCreate} className="panel flex flex-col gap-3 p-5">
        <h2 className="font-display text-xl text-parchment">Begin a ritual</h2>
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
          {busy ? "Summoning…" : "Create lobby"}
        </button>
      </form>

      <form onSubmit={onJoin} className="panel flex flex-col gap-3 p-5">
        <h2 className="font-display text-xl text-parchment">Join with a code</h2>
        <label className="flex flex-col gap-1 text-sm">
          Invite code
          <input
            className="input font-mono uppercase tracking-[0.3em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            required
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="btn-ghost" disabled={!code.trim()}>
          Join lobby
        </button>
      </form>

      {error && (
        <p role="alert" className="text-center text-sm text-blood">
          {error}
        </p>
      )}
    </div>
  );
}
