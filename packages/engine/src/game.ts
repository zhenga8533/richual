import { type BoardDefinition, getBoard, groupIndices, indicesOfKind, jailIndex } from "./board";
import { DECKS, type DeckId } from "./cards";
import { MAX_PLAYERS, MIN_PLAYERS, type RuleConfig } from "./config";
import { nextInt, seedRng, shuffle } from "./rng";
import {
  type Account,
  type Action,
  type ApplyResult,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerState,
  type RuleError,
  STATE_SCHEMA_VERSION,
  type TransferReason,
} from "./state";

export const WALKER = 5;

export type NewPlayer = { id: PlayerId; name: string };

export type ApplyOptions = {
  /** Fixed dice instead of the seeded RNG; for tests and tooling only. */
  dice?: readonly [number, number];
};

export function createGame(
  players: readonly NewPlayer[],
  config: RuleConfig,
  seed: number,
): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RangeError(`a game needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new Error("player ids must be unique");
  }
  const board = getBoard(config.boardId);

  const [order, afterOrder] = shuffle(seedRng(seed), players);
  let rng = afterOrder;
  const decks = {} as GameState["decks"];
  for (const deck of Object.values(DECKS)) {
    let drawPile: number[];
    [drawPile, rng] = shuffle(
      rng,
      deck.cards.map((_, i) => i),
    );
    decks[deck.id] = { drawPile };
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    config,
    players: order.map((p) => ({
      id: p.id,
      name: p.name,
      position: 0,
      cash: config.startingCash,
      inJail: false,
      jailAttempts: 0,
      getOutCards: [],
      bankrupt: false,
    })),
    owners: board.spaces.map(() => null),
    buildings: board.spaces.map(() => 0),
    decks,
    urn: 0,
    turn: { playerIndex: 0, number: 1, doublesCount: 0, extraRoll: false, lastRoll: null },
    phase: { kind: "awaitingRoll" },
    rng,
  };
}

export function currentPlayer(state: GameState): PlayerState {
  const player = state.players[state.turn.playerIndex];
  if (!player) throw new Error("turn points at a missing player");
  return player;
}

export function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.bankrupt);
}

/** Every action `playerId` may take right now. The UI enables exactly these. */
export function getLegalActions(state: GameState, playerId: PlayerId): Action[] {
  if (state.phase.kind === "gameOver") return [];
  const player = currentPlayer(state);
  if (player.id !== playerId || player.bankrupt) return [];

  switch (state.phase.kind) {
    case "awaitingRoll": {
      const actions: Action[] = [{ type: "roll" }];
      if (player.inJail && player.cash >= state.config.jailFine)
        actions.push({ type: "payJailFine" });
      if (player.inJail && player.getOutCards.length > 0) actions.push({ type: "useGetOutCard" });
      return actions;
    }
    case "awaitingBuy": {
      const space = getBoard(state.config.boardId).spaces[state.phase.space];
      const price = space && "price" in space ? space.price : Number.POSITIVE_INFINITY;
      return player.cash >= price ? [{ type: "buy" }, { type: "decline" }] : [{ type: "decline" }];
    }
    case "awaitingEndTurn":
      return [{ type: "endTurn" }];
  }
}

/**
 * Validates and applies one action. Never mutates `state`; on success returns
 * the next state plus the events that explain the transition.
 */
export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: Action,
  options: ApplyOptions = {},
): ApplyResult {
  const error = validate(state, playerId, action);
  if (error) return { ok: false, error };

  // State is plain JSON by contract, so a JSON round-trip is a faithful deep copy.
  const game = new Game(JSON.parse(JSON.stringify(state)) as GameState, options);
  game.dispatch(action);
  return { ok: true, state: game.state, events: game.events };
}

function validate(state: GameState, playerId: PlayerId, action: Action): RuleError | null {
  if (state.phase.kind === "gameOver") return { code: "game_over", message: "The game is over" };
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt) {
    return { code: "unknown_player", message: "You are not playing in this game" };
  }
  if (currentPlayer(state).id !== playerId) {
    return { code: "not_your_turn", message: "It is not your turn" };
  }
  if (!getLegalActions(state, playerId).some((a) => a.type === action.type)) {
    return { code: "illegal_action", message: `Cannot ${action.type} right now` };
  }
  return null;
}

type LandingOptions = {
  /** Multiplies zipline rent (the "pay double fare" cards). */
  ziplineMultiplier?: number;
  /** Replaces the utility multiplier and rolls fresh dice (the blackout card). */
  utilityMultiplier?: number;
};

/** Mutable working copy for a single action. */
class Game {
  readonly events: GameEvent[] = [];
  private readonly board: BoardDefinition;

  constructor(
    readonly state: GameState,
    private readonly options: ApplyOptions,
  ) {
    this.board = getBoard(state.config.boardId);
  }

  private get current(): PlayerState {
    return currentPlayer(this.state);
  }

  dispatch(action: Action): void {
    switch (action.type) {
      case "roll":
        this.roll();
        this.settle();
        return;
      case "payJailFine": {
        const p = this.current;
        this.transfer(p.id, this.feeAccount(), this.state.config.jailFine, "jailFine");
        this.leaveJail(p, "fine");
        return;
      }
      case "useGetOutCard": {
        const p = this.current;
        const deck = p.getOutCards.shift();
        if (!deck) throw new Error("no get-out card to use");
        this.returnGetOutCard(deck);
        this.leaveJail(p, "card");
        return;
      }
      case "buy":
        this.buy();
        this.settle();
        return;
      case "decline":
        if (this.state.phase.kind !== "awaitingBuy") throw new Error("decline outside awaitingBuy");
        this.emit({ type: "declined", playerId: this.current.id, space: this.state.phase.space });
        this.state.phase = { kind: "awaitingEndTurn" };
        this.settle();
        return;
      case "endTurn":
        this.passTurn();
        return;
    }
  }

  // ---------- Turn flow ----------

  private roll(): void {
    const p = this.current;
    const { config, turn } = this.state;
    const dice = this.rollDice();
    const [a, b] = dice;
    const doubles = a === b;
    turn.lastRoll = dice;
    turn.extraRoll = false;
    this.emit({ type: "rolled", playerId: p.id, dice });

    if (p.inJail) {
      if (doubles) {
        this.leaveJail(p, "doubles");
      } else {
        p.jailAttempts++;
        if (p.jailAttempts < config.maxJailTurns) return;
        if (!this.payFee(p, config.jailFine, "jailFine")) return;
        this.leaveJail(p, "fine");
      }
      // Leaving jail by any route never grants an extra roll.
      this.moveForward(p, a + b);
      return;
    }

    if (doubles) {
      turn.doublesCount++;
      if (turn.doublesCount >= 3) {
        this.sendToJail(p);
        return;
      }
      turn.extraRoll = true;
    }
    this.moveForward(p, a + b);
  }

  /** Chooses the next phase once the current roll has fully resolved. */
  private settle(): void {
    const { phase, turn } = this.state;
    if (phase.kind === "gameOver" || phase.kind === "awaitingBuy") return;
    const p = this.current;
    if (p.bankrupt) {
      this.passTurn();
    } else if (!p.inJail && turn.extraRoll) {
      this.state.phase = { kind: "awaitingRoll" };
    } else {
      this.state.phase = { kind: "awaitingEndTurn" };
    }
  }

  private passTurn(): void {
    const { players, turn } = this.state;
    let next = turn.playerIndex;
    do {
      next = (next + 1) % players.length;
    } while (players[next]?.bankrupt);
    this.state.turn = {
      playerIndex: next,
      number: turn.number + 1,
      doublesCount: 0,
      extraRoll: false,
      lastRoll: turn.lastRoll,
    };
    this.state.phase = { kind: "awaitingRoll" };
    this.emit({ type: "turnStarted", playerId: this.current.id });
  }

  private rollDice(): readonly [number, number] {
    if (this.options.dice) {
      const [a, b] = this.options.dice;
      if (![a, b].every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) {
        throw new RangeError(`invalid dice ${a},${b}`);
      }
      return [a, b];
    }
    let a: number;
    let b: number;
    [a, this.state.rng] = nextInt(this.state.rng, 1, 6);
    [b, this.state.rng] = nextInt(this.state.rng, 1, 6);
    return [a, b];
  }

  // ---------- Movement ----------

  private moveForward(p: PlayerState, steps: number, landing: LandingOptions = {}): void {
    const size = this.board.spaces.length;
    const from = p.position;
    const to = (from + steps) % size;
    p.position = to;
    this.emit({ type: "moved", playerId: p.id, from, to });
    if (from + steps >= size) {
      const { goSalary, doubleOnExactGo } = this.state.config;
      const salary = to === 0 && doubleOnExactGo ? goSalary * 2 : goSalary;
      this.transfer("bank", p.id, salary, "salary");
    }
    this.landOn(p, landing);
  }

  private moveBack(p: PlayerState, steps: number): void {
    const size = this.board.spaces.length;
    const from = p.position;
    p.position = (((from - steps) % size) + size) % size;
    this.emit({ type: "moved", playerId: p.id, from, to: p.position });
    this.landOn(p);
  }

  private forwardDistance(from: number, to: number): number {
    const size = this.board.spaces.length;
    return (((to - from) % size) + size) % size;
  }

  private sendToJail(p: PlayerState): void {
    const from = p.position;
    p.position = jailIndex(this.board);
    p.inJail = true;
    p.jailAttempts = 0;
    this.state.turn.extraRoll = false;
    this.emit({ type: "moved", playerId: p.id, from, to: p.position });
    this.emit({ type: "sentToJail", playerId: p.id });
  }

  private leaveJail(p: PlayerState, via: "doubles" | "fine" | "card"): void {
    p.inJail = false;
    p.jailAttempts = 0;
    this.emit({ type: "leftJail", playerId: p.id, via });
  }

  // ---------- Landing ----------

  private landOn(p: PlayerState, landing: LandingOptions = {}): void {
    const index = p.position;
    const space = this.board.spaces[index];
    if (!space) throw new Error(`no space at ${index}`);

    switch (space.kind) {
      case "property":
      case "zipline":
      case "utility": {
        const owner = this.state.owners[index];
        if (owner === null || owner === undefined) {
          this.state.phase = { kind: "awaitingBuy", space: index };
        } else if (owner !== p.id) {
          this.pay(p, owner, this.rent(index, landing), "rent");
        }
        return;
      }
      case "tax":
        this.payFee(p, space.amount, "tax");
        return;
      case "card":
        this.drawCard(p, space.deck);
        return;
      case "goToJail":
        this.sendToJail(p);
        return;
      case "freeParking":
        if (this.state.config.freeParkingJackpot && this.state.urn > 0) {
          this.transfer("urn", p.id, this.state.urn, "urn");
        }
        return;
      case "go":
      case "jail":
        return;
    }
  }

  private rent(index: number, landing: LandingOptions): number {
    const space = this.board.spaces[index];
    const owner = this.state.owners[index];
    if (!space || !owner) throw new Error(`no rent owed on ${index}`);
    const ownedOfKind = (kind: "zipline" | "utility") =>
      indicesOfKind(this.board, kind).filter((i) => this.state.owners[i] === owner).length;

    switch (space.kind) {
      case "property": {
        const buildings = this.state.buildings[index] ?? 0;
        const base = space.rent[buildings] ?? 0;
        const fullSet = groupIndices(this.board, space.group).every(
          (i) => this.state.owners[i] === owner,
        );
        return buildings === 0 && fullSet ? base * 2 : base;
      }
      case "zipline":
        return (
          (this.board.ziplineRent[ownedOfKind("zipline") - 1] ?? 0) *
          (landing.ziplineMultiplier ?? 1)
        );
      case "utility": {
        if (landing.utilityMultiplier !== undefined) {
          const dice = this.rollDice();
          this.emit({ type: "rolled", playerId: this.current.id, dice });
          return (dice[0] + dice[1]) * landing.utilityMultiplier;
        }
        const roll = this.state.turn.lastRoll;
        const total = roll ? roll[0] + roll[1] : 0;
        return total * (this.board.utilityMultiplier[ownedOfKind("utility") - 1] ?? 0);
      }
      default:
        throw new Error(`space ${index} does not charge rent`);
    }
  }

  private buy(): void {
    const { phase } = this.state;
    if (phase.kind !== "awaitingBuy") throw new Error("buy outside awaitingBuy");
    const space = this.board.spaces[phase.space];
    if (!space || !("price" in space)) throw new Error(`space ${phase.space} is not for sale`);
    const p = this.current;
    this.transfer(p.id, "bank", space.price, "purchase");
    this.state.owners[phase.space] = p.id;
    this.emit({ type: "bought", playerId: p.id, space: phase.space, price: space.price });
    this.state.phase = { kind: "awaitingEndTurn" };
  }

  // ---------- Cards ----------

  private drawCard(p: PlayerState, deckId: DeckId): void {
    const deck = DECKS[deckId];
    const pile = this.state.decks[deckId].drawPile;
    const cardIndex = pile.shift();
    const card = cardIndex === undefined ? undefined : deck.cards[cardIndex];
    if (cardIndex === undefined || !card) throw new Error(`deck ${deckId} is empty`);
    this.emit({ type: "cardDrawn", playerId: p.id, deck: deckId, cardId: card.id });

    const effect = card.effect;
    if (effect.kind === "getOutOfJail") {
      p.getOutCards.push(deckId);
      this.emit({ type: "receivedGetOutCard", playerId: p.id, deck: deckId });
      return;
    }
    pile.push(cardIndex);

    switch (effect.kind) {
      case "advanceTo":
        this.moveForward(p, this.forwardDistance(p.position, effect.space));
        return;
      case "advanceToNearest": {
        const targets = indicesOfKind(this.board, effect.target);
        const size = this.board.spaces.length;
        const steps = Math.min(...targets.map((t) => this.forwardDistance(p.position, t) || size));
        this.moveForward(
          p,
          steps,
          effect.target === "zipline" ? { ziplineMultiplier: 2 } : { utilityMultiplier: 10 },
        );
        return;
      }
      case "moveBy":
        if (effect.steps >= 0) this.moveForward(p, effect.steps);
        else this.moveBack(p, -effect.steps);
        return;
      case "goToJail":
        this.sendToJail(p);
        return;
      case "collect":
        this.transfer("bank", p.id, effect.amount, "card");
        return;
      case "pay":
        this.payFee(p, effect.amount, "card");
        return;
      case "collectFromEach":
        for (const other of activePlayers(this.state)) {
          if (other.id !== p.id) this.pay(other, p.id, effect.amount, "card");
        }
        return;
      case "payEach": {
        const others = activePlayers(this.state).filter((o) => o.id !== p.id);
        if (p.cash < effect.amount * others.length) {
          this.bankrupt(p, "bank");
          return;
        }
        for (const other of others) this.transfer(p.id, other.id, effect.amount, "card");
        return;
      }
      case "repairs": {
        let owed = 0;
        this.state.owners.forEach((owner, i) => {
          if (owner !== p.id) return;
          const count = this.state.buildings[i] ?? 0;
          owed += count === WALKER ? effect.perWalker : count * effect.perGuardian;
        });
        this.payFee(p, owed, "card");
        return;
      }
    }
  }

  private returnGetOutCard(deckId: DeckId): void {
    const index = DECKS[deckId].cards.findIndex((c) => c.effect.kind === "getOutOfJail");
    if (index < 0) throw new Error(`deck ${deckId} has no get-out card`);
    this.state.decks[deckId].drawPile.push(index);
  }

  // ---------- Money ----------

  /** Taxes, fines and card fees feed the Soul Urn when the jackpot rule is on. */
  private feeAccount(): Account {
    return this.state.config.freeParkingJackpot ? "urn" : "bank";
  }

  private payFee(p: PlayerState, amount: number, reason: TransferReason): boolean {
    if (amount <= 0) return true;
    if (p.cash < amount) {
      this.bankrupt(p, "bank");
      return false;
    }
    this.transfer(p.id, this.feeAccount(), amount, reason);
    return true;
  }

  /**
   * Pays another player, or goes bankrupt to them when cash runs short. Selling
   * and mortgaging to raise funds are not part of the rules yet, so a shortfall
   * is immediately fatal.
   */
  private pay(from: PlayerState, to: PlayerId, amount: number, reason: TransferReason): boolean {
    if (amount <= 0) return true;
    if (from.cash < amount) {
      this.bankrupt(from, to);
      return false;
    }
    this.transfer(from.id, to, amount, reason);
    return true;
  }

  private transfer(from: Account, to: Account, amount: number, reason: TransferReason): void {
    if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`invalid amount ${amount}`);
    if (amount === 0) return;
    this.adjust(from, -amount);
    this.adjust(to, amount);
    this.emit({ type: "transfer", from, to, amount, reason });
  }

  private adjust(account: Account, delta: number): void {
    if (account === "bank") return;
    if (account === "urn") {
      this.state.urn += delta;
    } else {
      const player = this.state.players.find((p) => p.id === account);
      if (!player) throw new Error(`unknown account ${account}`);
      player.cash += delta;
    }
    if (this.state.urn < 0 || this.state.players.some((p) => p.cash < 0)) {
      throw new Error(`transfer overdrew ${account}`);
    }
  }

  private bankrupt(p: PlayerState, creditor: PlayerId | "bank"): void {
    const heir = creditor === "bank" ? null : this.state.players.find((o) => o.id === creditor);
    if (creditor !== "bank" && !heir) throw new Error(`unknown creditor ${creditor}`);

    this.state.owners.forEach((owner, i) => {
      if (owner !== p.id) return;
      const buildings = this.state.buildings[i] ?? 0;
      const space = this.board.spaces[i];
      if (buildings > 0 && heir && space?.kind === "property") {
        // Buildings are sold back to the bank at half price; the proceeds go to the creditor.
        this.transfer("bank", p.id, Math.floor((space.buildCost * buildings) / 2), "bankruptcy");
      }
      this.state.buildings[i] = 0;
      this.state.owners[i] = heir ? heir.id : null;
    });
    this.transfer(p.id, heir ? heir.id : "bank", p.cash, "bankruptcy");
    if (heir) heir.getOutCards.push(...p.getOutCards);
    else for (const deck of p.getOutCards) this.returnGetOutCard(deck);

    p.getOutCards = [];
    p.inJail = false;
    p.jailAttempts = 0;
    p.bankrupt = true;
    this.emit({ type: "bankrupt", playerId: p.id, creditor });

    const remaining = activePlayers(this.state);
    if (remaining.length === 1 && remaining[0]) {
      this.state.phase = { kind: "gameOver", winnerId: remaining[0].id };
      this.emit({ type: "gameOver", winnerId: remaining[0].id });
    }
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }
}
