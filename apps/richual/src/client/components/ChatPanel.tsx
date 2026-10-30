import { type LobbySnapshot, MAX_CHAT_LENGTH } from "@richual/protocol";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { send, useConnection } from "../connection";
import { seatColor } from "../theme";

export function ChatPanel({ lobby }: { lobby: LobbySnapshot }) {
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
    <section className="panel flex max-h-72 flex-col p-4" aria-labelledby="chat-heading">
      <h2 id="chat-heading" className="mb-2 font-display text-lg">
        Chat
      </h2>
      <ol className="mb-2 flex-1 space-y-1 overflow-y-auto text-sm" aria-live="polite">
        {lobby.chat.length === 0 && <li className="text-parchment-dim">No messages yet.</li>}
        {lobby.chat.map((m) => {
          const author = lobby.players.find((p) => p.id === m.playerId);
          return (
            <li key={m.id} className="break-words">
              <span className="font-semibold" style={{ color: seatColor(author?.seat ?? 0) }}>
                {m.playerId === playerId ? "You" : (author?.name ?? "Someone")}:
              </span>{" "}
              {m.text}
            </li>
          );
        })}
        <li ref={end} aria-hidden />
      </ol>
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <input
          id="chat-input"
          className="input py-1"
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="btn-ghost px-3 py-1 text-sm" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
