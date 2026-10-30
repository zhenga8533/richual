import { type LobbySnapshot, MAX_CHAT_LENGTH } from "@richual/protocol";
import { SendHorizontal } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { send, useConnection } from "../connection";
import { seatColor } from "../theme";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../ui/cn";
import { Input } from "../ui/field";

/** Chat in its own card, for the lobby. */
export function ChatPanel({ lobby }: { lobby: LobbySnapshot }) {
  return (
    <Card aria-labelledby="chat-heading">
      <CardHeader>
        <CardTitle id="chat-heading">Chat</CardTitle>
      </CardHeader>
      <CardContent>
        <Chat lobby={lobby} className="h-56" />
      </CardContent>
    </Card>
  );
}

/** Message list and composer; fills whatever space it is given. */
export function Chat({ lobby, className }: { lobby: LobbySnapshot; className?: string }) {
  const { playerId } = useConnection();
  const [text, setText] = useState("");
  const end = useRef<HTMLLIElement>(null);
  const lastId = lobby.chat.at(-1)?.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a new message arrives
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lastId]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && send({ type: "chat", text })) setText("");
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm" aria-live="polite">
        {lobby.chat.length === 0 && <li className="text-muted">No messages yet.</li>}
        {lobby.chat.map((m) => {
          const author = lobby.players.find((p) => p.id === m.playerId);
          return (
            <li key={m.id} className="flex gap-2 break-words">
              <span
                className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{ background: seatColor(author?.seat ?? 0) }}
                aria-hidden
              />
              <span>
                <span className="font-semibold">
                  {m.playerId === playerId ? "You" : (author?.name ?? "Someone")}
                </span>{" "}
                <span className="text-fg/90">{m.text}</span>
              </span>
            </li>
          );
        })}
        <li ref={end} aria-hidden />
      </ol>
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <Input
          id="chat-input"
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          placeholder="Say something…"
        />
        <Button type="submit" size="icon" disabled={!text.trim()} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
