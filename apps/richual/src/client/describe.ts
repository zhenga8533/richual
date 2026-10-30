import {
  type Account,
  type BoardDefinition,
  DECKS,
  type GameEvent,
  type PlayerId,
  WALKER,
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
  const souls = (n: number) => `${n} ${SOULS}`;

  switch (event.type) {
    case "turnStarted":
      return `${name(event.playerId)}'s turn`;
    case "rolled":
      return `${name(event.playerId)} rolled ${event.dice[0]} + ${event.dice[1]}${
        event.speed === undefined ? "" : event.speed === "patron" ? " + ★" : ` + ${event.speed}`
      }`;
    case "moved":
      return `${name(event.playerId)} moved to ${space(event.to)}`;
    case "bought":
      return `${name(event.playerId)} bought ${space(event.space)} for ${souls(event.price)}`;
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
    case "built":
      return event.buildings === WALKER
        ? `${name(event.playerId)} raised a Walker on ${space(event.space)}`
        : `${name(event.playerId)} built a Guardian on ${space(event.space)} (${event.buildings})`;
    case "soldBuilding":
      return `${name(event.playerId)} sold a building on ${space(event.space)}`;
    case "sealed":
      return `${name(event.playerId)} sealed ${space(event.space)}`;
    case "unsealed":
      return `${name(event.playerId)} unsealed ${space(event.space)}`;
    case "auctionStarted":
      return `${space(event.space)} goes to auction`;
    case "bid":
      return `${name(event.playerId)} bid ${souls(event.amount)}`;
    case "passedAuction":
      return `${name(event.playerId)} dropped out of the auction`;
    case "auctionWon":
      return `${name(event.playerId)} won ${space(event.space)} for ${souls(event.price)}`;
    case "auctionUnsold":
      return `Nobody bid on ${space(event.space)}`;
    case "debtOwed":
      return `${name(event.debtor)} owes ${account(event.creditor)} ${souls(event.amount)} and must raise funds`;
    case "tradeProposed":
      return `${name(event.trade.from)} offered ${name(event.trade.to)} a trade`;
    case "tradeAccepted":
      return `${name(event.to)} accepted ${name(event.from)}'s trade`;
    case "tradeRejected":
      return `${name(event.to)} turned down ${name(event.from)}'s trade`;
    case "tradeCancelled":
      return event.reason === "withdrawn"
        ? `${name(event.from)} withdrew a trade offer`
        : `${name(event.from)}'s offer to ${name(event.to)} lapsed`;
    case "bankrupt":
      return `${name(event.playerId)} is soul-bankrupt${event.creditor === "bank" ? "" : ` to ${name(event.creditor)}`}`;
    case "gameOver":
      return event.reason === "endedEarly"
        ? `The host ended the game. ${name(event.winnerId)} leads on net worth.`
        : `${name(event.winnerId)} completes the ritual and wins!`;
    case "timedOut":
      return event.playerIds.length > 0
        ? `Time ran out for ${event.playerIds.map(name).join(", ")}; auto-played`
        : null;
    case "finalRound":
      return `Time is up: round ${event.round} is the final round`;
    case "transfer":
      switch (event.reason) {
        case "salary":
          return `${account(event.to)} collected ${souls(event.amount)} at the Astral Gate`;
        case "rent":
          return `${account(event.from)} paid ${account(event.to)} ${souls(event.amount)} rent`;
        case "tax":
          return `${account(event.from)} paid ${souls(event.amount)} in tithes`;
        case "jailFine":
          return `${account(event.from)} paid a ${souls(event.amount)} fine`;
        case "urn":
          return `${account(event.to)} emptied the Soul Urn: ${souls(event.amount)}`;
        case "card":
          return event.from === "bank"
            ? `${account(event.to)} received ${souls(event.amount)}`
            : `${account(event.from)} paid ${account(event.to)} ${souls(event.amount)}`;
        case "bankruptcy":
          return `${account(event.from)}'s remaining ${souls(event.amount)} went to ${account(event.to)}`;
        // Purchases, buildings, seals, auctions and trades have their own clearer events.
        case "purchase":
        case "building":
        case "seal":
        case "unseal":
        case "auction":
        case "trade":
          return null;
      }
  }
}
