import { LobbyCode, SeatCode } from "@richual/protocol";
import { type FormEvent, useState } from "react";
import { createLobby } from "../api";
import { lobbyPath, navigate, seatHash } from "../router";
import { loadName, saveName, saveSession } from "../session";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input, Label } from "../ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/radix";

export function Landing() {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState("");
  const [seatCode, setSeatCode] = useState("");
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
    const seat = seatCode.trim().toUpperCase();
    if (seat && !SeatCode.safeParse(seat).success) {
      setError("Seat codes are 6 letters or digits.");
      return;
    }
    navigate(`${lobbyPath(parsed.data)}${seat ? seatHash(seat) : ""}`);
  };

  return (
    <div className="flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-8">
      <header className="text-center">
        <h1 className="font-display text-6xl text-accent-text">Richual</h1>
        <p className="mt-3 text-muted">
          Trade souls across the Cursed Apple while the Patrons wait.
        </p>
      </header>

      <Card className="p-2">
        <Tabs defaultValue="create" onValueChange={() => setError(null)}>
          <TabsList>
            <TabsTrigger value="create">New game</TabsTrigger>
            <TabsTrigger value="join">Join a game</TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <form onSubmit={onCreate} className="flex flex-col gap-4 p-3 pt-5">
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
                {busy ? "Summoning…" : "Create lobby"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="join">
            <form onSubmit={onJoin} className="flex flex-col gap-4 p-3 pt-5">
              <Label>
                Invite code
                <Input
                  className="font-mono text-base tracking-[0.3em] uppercase"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={6}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABC123"
                />
              </Label>
              <Label>
                <span>
                  Seat code <span className="font-normal text-muted">(optional)</span>
                </span>
                <Input
                  className="font-mono text-base tracking-[0.3em] uppercase"
                  value={seatCode}
                  onChange={(e) => setSeatCode(e.target.value)}
                  maxLength={6}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="seat-code-hint"
                />
                <span id="seat-code-hint" className="text-xs font-normal text-muted">
                  Continuing from another device? Enter the code it shows under “Continue on another
                  device”.
                </span>
              </Label>
              <Button type="submit" variant="primary" size="lg" disabled={!code.trim()}>
                Join lobby
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </Card>

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
