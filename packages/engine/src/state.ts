import type { DeckId } from "./cards";
import type { RuleConfig } from "./config";
import type { RngState } from "./rng";

export const STATE_SCHEMA_VERSION = 2;

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
  | {
      kind: "auction";
      space: number;
      highBid: number;
      highBidder: PlayerId | null;
      /** Players still in the auction, in turn order. */
      bidders: PlayerId[];
    }
  /** Someone owes more than they hold; see `debts`. */
  | { kind: "raisingFunds" }
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
  | "bankruptcy"
  | "building"
  | "seal"
  | "unseal"
  | "auction"
  | "trade";

/** What happens once a debt is paid. */
export type DebtContinuation = { kind: "leaveJailAndMove"; steps: number };

/** A payment the debtor could not cover from cash but could by selling or sealing. */
export type Debt = {
  debtor: PlayerId;
  creditor: Account;
  amount: number;
  reason: TransferReason;
  then?: DebtContinuation;
};

export type TradeBundle = {
  cash: number;
  spaces: number[];
  getOutCards: DeckId[];
};

export type Trade = {
  id: number;
  from: PlayerId;
  to: PlayerId;
  /** What `from` gives. */
  offer: TradeBundle;
  /** What `to` gives in return. */
  request: TradeBundle;
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
  /** Whether each space is Sealed (mortgaged). */
  sealed: boolean[];
  decks: Record<DeckId, DeckState>;
  /** Souls collected in the Soul Urn when the jackpot rule is on. */
  urn: number;
  turn: TurnState;
  phase: Phase;
  /** Outstanding debts, oldest first; the first one is being raised. */
  debts: Debt[];
  /** Spaces waiting to be auctioned after a bankruptcy to the bank. */
  auctionQueue: number[];
  trades: Trade[];
  nextTradeId: number;
  rng: RngState;
};

export type Action =
  | { type: "roll" }
  | { type: "payJailFine" }
  | { type: "useGetOutCard" }
  | { type: "buy" }
  | { type: "decline" }
  | { type: "endTurn" }
  | { type: "build"; space: number }
  | { type: "sellBuilding"; space: number }
  | { type: "seal"; space: number }
  | { type: "unseal"; space: number }
  | { type: "bid"; amount: number }
  | { type: "passAuction" }
  | { type: "payDebt" }
  | { type: "declareBankruptcy" }
  | { type: "proposeTrade"; to: PlayerId; offer: TradeBundle; request: TradeBundle }
  | { type: "acceptTrade"; tradeId: number }
  | { type: "rejectTrade"; tradeId: number }
  | { type: "cancelTrade"; tradeId: number };

export type ActionType = Action["type"];

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
  | { type: "built"; playerId: PlayerId; space: number; buildings: number }
  | { type: "soldBuilding"; playerId: PlayerId; space: number; buildings: number }
  | { type: "sealed"; playerId: PlayerId; space: number }
  | { type: "unsealed"; playerId: PlayerId; space: number }
  | { type: "auctionStarted"; space: number }
  | { type: "bid"; playerId: PlayerId; amount: number }
  | { type: "passedAuction"; playerId: PlayerId }
  | { type: "auctionWon"; playerId: PlayerId; space: number; price: number }
  | { type: "auctionUnsold"; space: number }
  | { type: "debtOwed"; debtor: PlayerId; creditor: Account; amount: number }
  | { type: "tradeProposed"; trade: Trade }
  | { type: "tradeAccepted"; tradeId: number; from: PlayerId; to: PlayerId }
  | { type: "tradeRejected"; tradeId: number; from: PlayerId; to: PlayerId }
  | {
      type: "tradeCancelled";
      tradeId: number;
      from: PlayerId;
      to: PlayerId;
      reason: "withdrawn" | "invalid";
    }
  | { type: "bankrupt"; playerId: PlayerId; creditor: PlayerId | "bank" }
  | { type: "turnStarted"; playerId: PlayerId }
  | { type: "gameOver"; winnerId: PlayerId };

export type RuleErrorCode = "game_over" | "unknown_player" | "not_your_turn" | "illegal_action";

export type RuleError = { code: RuleErrorCode; message: string };

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: RuleError };
