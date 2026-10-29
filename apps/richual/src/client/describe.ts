import {
  type Account,
  type BoardDefinition,
  DECKS,
  type GameEvent,
  type PlayerId,
} from "@richual/engine";
import { SOULS } from "./theme";

type Names = (id: PlayerId) => string;

/** One log line for an event, or null for events that would only add noise. */
export function describeEvent(
  event: GameEvent,
  name: Names,
  board: BoardDefinition,
): string | null {
  const space = (i: number) => board.spaces[i]?.name ?? `space ${i}`;
  const account = (a: Account) =>
    a === "bank" ? "the bank" : a === "urn" ? "the Soul Urn" : name(a);

  switch (event.type) {
    case "turnStarted":
      return `${name(event.playerId)}'s turn`;
    case "rolled":
      return `${name(event.playerId)} rolled ${event.dice[0]} + ${event.dice[1]}`;
    case "moved":
      return `${name(event.playerId)} moved to ${space(event.to)}`;
    case "bought":
      return `${name(event.playerId)} bought ${space(event.space)} for ${event.price} ${SOULS}`;
    case "declined":
      return `${name(event.playerId)} passed on ${space(event.space)}`;
    case "cardDrawn": {
      const card = DECKS[event.deck].cards.find((c) => c.id === event.cardId);
      return `${name(event.playerId)} drew from ${DECKS[event.deck].name}: “${card?.text ?? event.cardId}”`;
    }
    case "sentToJail":
      return `${name(event.playerId)} was banished to the Lost Whisper`;
    case "leftJail": {
      const how = {
        doubles: "rolling doubles",
        fine: "paying the fine",
        card: "using an escape card",
      };
      return `${name(event.playerId)} left the Lost Whisper by ${how[event.via]}`;
    }
    case "receivedGetOutCard":
      return null;
    case "bankrupt":
      return `${name(event.playerId)} is soul-bankrupt${event.creditor === "bank" ? "" : ` to ${name(event.creditor)}`}`;
    case "gameOver":
      return `${name(event.winnerId)} completes the ritual and wins!`;
    case "transfer": {
      const amount = `${event.amount} ${SOULS}`;
      switch (event.reason) {
        case "salary":
          return `${account(event.to)} collected ${amount} at the Astral Gate`;
        case "purchase":
          return null;
        case "rent":
          return `${account(event.from)} paid ${account(event.to)} ${amount} rent`;
        case "tax":
          return `${account(event.from)} paid ${amount} in tithes`;
        case "jailFine":
          return `${account(event.from)} paid a ${amount} fine`;
        case "urn":
          return `${account(event.to)} emptied the Soul Urn: ${amount}`;
        case "card":
          return event.from === "bank"
            ? `${account(event.to)} received ${amount}`
            : `${account(event.from)} paid ${account(event.to)} ${amount}`;
        case "bankruptcy":
          return `${account(event.from)}'s remaining ${amount} went to ${account(event.to)}`;
      }
    }
  }
}
