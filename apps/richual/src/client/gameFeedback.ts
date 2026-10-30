import { type BoardDefinition, type GameEvent, getBoard, type PlayerId } from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import { useEffect, useRef } from "react";
import type { LoggedEvent } from "./connection";
import { playSound, type SoundName } from "./sound";
import { SOULS } from "./theme";
import { pushToast } from "./toasts";

/** When several things happen at once, only the most telling sound plays. */
const SOUND_PRIORITY: SoundName[] = [
  "win",
  "bankrupt",
  "buy",
  "card",
  "coinUp",
  "coinDown",
  "dice",
  "bid",
];

function soundFor(event: GameEvent, me: PlayerId | null): SoundName | null {
  switch (event.type) {
    case "rolled":
      return "dice";
    case "bought":
    case "auctionWon":
      return "buy";
    case "cardDrawn":
      return "card";
    case "bid":
      return "bid";
    case "bankrupt":
      return "bankrupt";
    case "gameOver":
      return "win";
    case "transfer":
      if (event.reason === "purchase" || event.reason === "auction") return null;
      if (event.to === me) return "coinUp";
      if (event.from === me) return "coinDown";
      return null;
    default:
      return null;
  }
}

/** Things worth telling you about even if you weren't watching the board. */
function toastFor(
  event: GameEvent,
  me: PlayerId | null,
  name: (id: string) => string,
  board: BoardDefinition,
): { text: string; tone: "info" | "good" } | null {
  const souls = (n: number) => `${n} ${SOULS}`;
  switch (event.type) {
    case "transfer":
      if (event.to !== me || event.from === "bank") return null;
      if (event.reason === "rent") {
        return { text: `${name(event.from)} paid you ${souls(event.amount)} rent`, tone: "good" };
      }
      if (event.reason === "urn") {
        return { text: `You emptied the Soul Urn: ${souls(event.amount)}`, tone: "good" };
      }
      if (event.reason === "card" && event.from !== "urn") {
        return { text: `${name(event.from)} paid you ${souls(event.amount)}`, tone: "good" };
      }
      return null;
    case "tradeProposed":
      return event.trade.to === me
        ? { text: `${name(event.trade.from)} offered you a trade`, tone: "info" }
        : null;
    case "tradeAccepted":
      return event.from === me
        ? { text: `${name(event.to)} accepted your trade`, tone: "good" }
        : null;
    case "tradeRejected":
      return event.from === me
        ? { text: `${name(event.to)} declined your trade`, tone: "info" }
        : null;
    case "auctionWon":
      return event.playerId === me
        ? { text: `You won ${board.spaces[event.space]?.name ?? "the auction"}`, tone: "good" }
        : null;
    case "bankrupt":
      return event.playerId === me
        ? null
        : { text: `${name(event.playerId)} is soul-bankrupt`, tone: "info" };
    default:
      return null;
  }
}

/** Plays sounds and shows personal toasts for events that arrive while you're playing. */
export function useGameFeedback(
  log: LoggedEvent[],
  historySeq: number,
  me: PlayerId | null,
  lobby: LobbySnapshot,
): void {
  const handled = useRef(historySeq);
  const lastSeq = log.at(-1)?.seq ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per new batch of events
  useEffect(() => {
    // Replayed history (after a reload or reconnect) is neither sounded nor toasted.
    handled.current = Math.max(handled.current, historySeq);
    const fresh = log.filter((l) => l.seq > handled.current);
    handled.current = lastSeq;
    if (fresh.length === 0 || !lobby.game) return;

    const board = getBoard(lobby.game.config.boardId);
    const name = (id: string) => lobby.players.find((p) => p.id === id)?.name ?? "Someone";
    const sounds = new Set(fresh.map((l) => soundFor(l.event, me)));
    const sound = SOUND_PRIORITY.find((s) => sounds.has(s));
    if (sound) playSound(sound);
    for (const { event } of fresh) {
      const toast = toastFor(event, me, name, board);
      if (toast) pushToast(toast.text, toast.tone);
    }
  }, [lastSeq, historySeq]);
}
