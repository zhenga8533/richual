import type { DeckId } from "./cards";
import type { RuleConfig } from "./config";
import type { RngState } from "./rng";

export const STATE_SCHEMA_VERSION = 1;

export type PlayerId = string;

export type PlayerState = {
  id: PlayerId;
  name: string;
  position: number;
  cash: number;
  inJail: boolean;
  /** Failed attempts to roll doubles during the current jail stay. */
  jailAttempts: number;
  /** Get-out-of-jail cards held, by the deck they came from. */
  getOutCards: DeckId[];
  bankrupt: boolean;
};

export type Phase =
  | { kind: "awaitingRoll" }
  | { kind: "awaitingBuy"; space: number }
  | { kind: "awaitingEndTurn" }
  | { kind: "gameOver"; winnerId: PlayerId };

export type TurnState = {
  /** Index into `players` of the player whose turn it is. */
  playerIndex: number;
  /** Increments every time the turn passes; used for round counting. */
  number: number;
  /** Consecutive doubles rolled this turn. */
  doublesCount: number;
  /** Whether the current roll entitles the player to roll again once it resolves. */
  extraRoll: boolean;
  lastRoll: readonly [number, number] | null;
};

export type DeckState = {
  /** Card indices into the deck definition, top first. Held get-out cards are removed. */
  drawPile: number[];
};

/**
 * The complete, serializable game state. Plain JSON only: it is persisted as-is
 * and replaying the same actions from the same initial state reproduces it.
 */
export type GameState = {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  config: RuleConfig;
  players: PlayerState[];
  /** Owner of each board space, indexed like the board; null for unowned or unownable. */
  owners: (PlayerId | null)[];
  /** Buildings on each space: 0–4 Guardians, or 5 for a Walker. */
  buildings: number[];
  decks: Record<DeckId, DeckState>;
  /** Souls collected in the Soul Urn when the jackpot rule is on. */
  urn: number;
  turn: TurnState;
  phase: Phase;
  rng: RngState;
};

export type Action =
  | { type: "roll" }
  | { type: "payJailFine" }
  | { type: "useGetOutCard" }
  | { type: "buy" }
  | { type: "decline" }
  | { type: "endTurn" };

export type ActionType = Action["type"];

/** Where money moves from or to; "urn" is the Soul Urn jackpot. */
export type Account = PlayerId | "bank" | "urn";

export type TransferReason =
  | "salary"
  | "purchase"
  | "rent"
  | "tax"
  | "jailFine"
  | "card"
  | "urn"
  | "bankruptcy";

export type GameEvent =
  | { type: "rolled"; playerId: PlayerId; dice: readonly [number, number] }
  | { type: "moved"; playerId: PlayerId; from: number; to: number }
  | { type: "transfer"; from: Account; to: Account; amount: number; reason: TransferReason }
  | { type: "bought"; playerId: PlayerId; space: number; price: number }
  | { type: "declined"; playerId: PlayerId; space: number }
  | { type: "cardDrawn"; playerId: PlayerId; deck: DeckId; cardId: string }
  | { type: "sentToJail"; playerId: PlayerId }
  | { type: "leftJail"; playerId: PlayerId; via: "doubles" | "fine" | "card" }
  | { type: "receivedGetOutCard"; playerId: PlayerId; deck: DeckId }
  | { type: "bankrupt"; playerId: PlayerId; creditor: PlayerId | "bank" }
  | { type: "turnStarted"; playerId: PlayerId }
  | { type: "gameOver"; winnerId: PlayerId };

export type RuleErrorCode = "game_over" | "unknown_player" | "not_your_turn" | "illegal_action";

export type RuleError = { code: RuleErrorCode; message: string };

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: RuleError };
