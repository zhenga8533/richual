import {
  type BoardDefinition,
  getBoard,
  groupIndices,
  indicesOfKind,
  isOwnable,
  jailIndex,
} from "./board";
import { DECKS, type DeckId } from "./cards";
import { MAX_PLAYERS, MIN_PLAYERS, type RuleConfig } from "./config";
import { checkAction, getLegalActions } from "./legal";
import { nextInt, seedRng, shuffle } from "./rng";
import {
  activePlayers,
  buildingRank,
  currentPlayer,
  levelAfterSale,
  liquidationValue,
  mortgageValue,
  nextBuildingLevel,
  sealedTransferFee,
  tradeProblem,
  unsealCost,
  WALKER,
} from "./rules";
import { computeStandings } from "./scoring";
import {
  type Account,
  type Action,
  type ApplyResult,
  type DebtContinuation,
  type GameEvent,
  type GameOverReason,
  type GameState,
  type PlayerId,
  type PlayerState,
  type SpeedFace,
  STATE_SCHEMA_VERSION,
  type Trade,
  type TradeBundle,
  type TransferReason,
} from "./state";

export type NewPlayer = { id: PlayerId; name: string };

export type ApplyOptions = {
  /** Fixed dice instead of the seeded RNG; for tests and tooling only. */
  dice?: readonly [number, number];
  /** A fixed Speed Die face, when the Speed Die is in play; for tests only. */
  speed?: SpeedFace;
};

const SPEED_FACES: readonly SpeedFace[] = [1, 2, 3, 1, 2, "patron"];

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
  let deal: number[];
  [deal, rng] = shuffle(
    rng,
    board.spaces.flatMap((s, i) => (isOwnable(s) ? [i] : [])),
  );
  const decks = {} as GameState["decks"];
  for (const deck of Object.values(DECKS)) {
    let drawPile: number[];
    [drawPile, rng] = shuffle(
      rng,
      deck.cards.map((_, i) => i),
    );
    decks[deck.id] = { drawPile };
  }

  const state: GameState = {
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
    sealed: board.spaces.map(() => false),
    decks,
    urn: 0,
    turn: {
      playerIndex: 0,
      number: 1,
      round: 1,
      doublesCount: 0,
      extraRoll: false,
      lastRoll: null,
      lastSpeed: null,
    },
    phase: { kind: "awaitingRoll" },
    debts: [],
    auctionQueue: [],
    trades: [],
    nextTradeId: 1,
    eliminationOrder: [],
    finalRound: null,
    rng,
  };

  // Deal starting properties round-robin; each player pays the printed price.
  for (let i = 0; i < config.startingProperties * state.players.length; i++) {
    const space = deal[i];
    const player = state.players[i % state.players.length];
    const s = space === undefined ? undefined : board.spaces[space];
    if (space === undefined || !player || !s || !isOwnable(s)) break;
    state.owners[space] = player.id;
    player.cash -= s.price;
  }
  return state;
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
  const error = checkAction(state, playerId, action);
  if (error) return { ok: false, error };

  // State is plain JSON by contract, so a JSON round-trip is a faithful deep copy.
  const game = new Game(JSON.parse(JSON.stringify(state)) as GameState, options);
  game.dispatch(playerId, action);
  return { ok: true, state: game.state, events: game.events };
}

/**
 * Auto-plays whoever is holding the game up when their decision timer runs out.
 * Only safe defaults: roll, pass on purchases and auctions, end the turn, and
 * raise owed funds by selling buildings, then sealing; never trades.
 */
export function applyTimeout(state: GameState): ApplyResult {
  if (state.phase.kind === "gameOver") {
    return { ok: false, error: { code: "game_over", message: "The game is over" } };
  }
  let current = state;
  const events: GameEvent[] = [];
  const timedOut = new Set<PlayerId>();
  const step = (playerId: PlayerId, action: Action) => {
    const result = applyAction(current, playerId, action);
    if (!result.ok) {
      throw new Error(`timeout action ${action.type} failed: ${result.error.message}`);
    }
    current = result.state;
    events.push(...result.events);
    timedOut.add(playerId);
  };

  const { phase } = current;
  switch (phase.kind) {
    case "auction":
      for (const bidder of phase.bidders) {
        const live = current.phase;
        if (live.kind !== "auction" || live.space !== phase.space) break;
        if (bidder !== live.highBidder) step(bidder, { type: "passAuction" });
      }
      break;
    case "raisingFunds": {
      const debtor = current.debts[0]?.debtor;
      if (!debtor) throw new Error("raising funds without a debt");
      while (current.phase.kind === "raisingFunds" && current.debts[0]?.debtor === debtor) {
        const legal = getLegalActions(current, debtor);
        const pick =
          legal.find((a) => a.type === "payDebt") ??
          legal.find((a) => a.type === "sellBuilding") ??
          legal.find((a) => a.type === "seal") ??
          legal.find((a) => a.type === "declareBankruptcy");
        if (!pick) throw new Error("debtor has no way to settle");
        step(debtor, pick);
      }
      break;
    }
    case "awaitingRoll":
      step(currentPlayer(current).id, { type: "roll" });
      break;
    case "awaitingBuy":
      step(currentPlayer(current).id, { type: "decline" });
      break;
    case "awaitingEndTurn":
      step(currentPlayer(current).id, { type: "endTurn" });
      break;
  }
  return {
    ok: true,
    state: current,
    events: [{ type: "timedOut", playerIds: [...timedOut] }, ...events],
  };
}

/** The time limit expired: play continues until the current round is complete. */
export function startFinalRound(state: GameState): ApplyResult {
  if (state.phase.kind === "gameOver") {
    return { ok: false, error: { code: "game_over", message: "The game is over" } };
  }
  const next = JSON.parse(JSON.stringify(state)) as GameState;
  next.finalRound = next.turn.round;
  return { ok: true, state: next, events: [{ type: "finalRound", round: next.turn.round }] };
}

/** The host ends the game now; standings are by net worth. */
export function endEarly(state: GameState): ApplyResult {
  if (state.phase.kind === "gameOver") {
    return { ok: false, error: { code: "game_over", message: "The game is over" } };
  }
  const game = new Game(JSON.parse(JSON.stringify(state)) as GameState, {});
  game.endGame("endedEarly");
  return { ok: true, state: game.state, events: game.events };
}

type LandingOptions = {
  /** Multiplies zipline rent (the "pay double fare" cards). */
  ziplineMultiplier?: number;
  /** Replaces the utility multiplier and rolls fresh dice (the blackout card). */
  utilityMultiplier?: number;
};

/** Placeholder phase while an action resolves; `settle` replaces it. */
const RESOLVING = { kind: "awaitingEndTurn" } as const;

/** Mutable working copy for a single, already validated action. */
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

  private player(id: PlayerId): PlayerState {
    const player = this.state.players.find((p) => p.id === id);
    if (!player) throw new Error(`unknown player ${id}`);
    return player;
  }

  dispatch(actorId: PlayerId, action: Action): void {
    const actor = this.player(actorId);
    switch (action.type) {
      case "roll":
        this.roll();
        this.settle();
        break;
      case "payJailFine":
        this.transfer(actor.id, this.feeAccount(), this.state.config.jailFine, "jailFine");
        this.leaveJail(actor, "fine");
        break;
      case "useGetOutCard": {
        const deck = actor.getOutCards.shift();
        if (!deck) throw new Error("no get-out card to use");
        this.returnGetOutCard(deck);
        this.leaveJail(actor, "card");
        break;
      }
      case "buy":
        this.buy(actor);
        this.settle();
        break;
      case "decline": {
        const space = this.requireBuyPhase();
        this.emit({ type: "declined", playerId: actor.id, space });
        this.state.phase = RESOLVING;
        if (this.state.config.auctions) this.startAuction(space);
        this.settle();
        break;
      }
      case "endTurn":
        this.passTurn();
        break;
      case "build":
        this.build(actor, action.space);
        break;
      case "sellBuilding":
        this.sellBuilding(actor, action.space);
        break;
      case "seal":
        this.state.sealed[action.space] = true;
        this.transfer("bank", actor.id, mortgageValue(this.board, action.space), "seal");
        this.emit({ type: "sealed", playerId: actor.id, space: action.space });
        break;
      case "unseal":
        this.transfer(actor.id, "bank", unsealCost(this.board, action.space), "unseal");
        this.state.sealed[action.space] = false;
        this.emit({ type: "unsealed", playerId: actor.id, space: action.space });
        break;
      case "bid":
        this.bid(actor, action.amount);
        break;
      case "passAuction":
        this.passAuction(actor);
        break;
      case "payDebt":
        this.payDebt();
        break;
      case "declareBankruptcy": {
        const debt = this.state.debts[0];
        if (!debt) throw new Error("no debt to default on");
        this.bankrupt(actor, debt.creditor === "urn" ? "bank" : debt.creditor);
        if (this.state.phase.kind !== "gameOver") this.state.phase = RESOLVING;
        this.settle();
        break;
      }
      case "proposeTrade": {
        const trade = {
          id: this.state.nextTradeId++,
          from: actor.id,
          to: action.to,
          offer: copyBundle(action.offer),
          request: copyBundle(action.request),
        };
        this.state.trades.push(trade);
        this.emit({ type: "tradeProposed", trade });
        break;
      }
      case "acceptTrade":
        this.executeTrade(action.tradeId);
        break;
      case "rejectTrade": {
        const { from, to } = this.removeTrade(action.tradeId);
        this.emit({ type: "tradeRejected", tradeId: action.tradeId, from, to });
        break;
      }
      case "cancelTrade": {
        const { from, to } = this.removeTrade(action.tradeId);
        this.emit({
          type: "tradeCancelled",
          tradeId: action.tradeId,
          from,
          to,
          reason: "withdrawn",
        });
        break;
      }
    }
    this.pruneTrades();
  }

  // ---------- Turn flow ----------

  private roll(): void {
    const p = this.current;
    const { config, turn } = this.state;
    const dice = this.rollDice();
    const [a, b] = dice;
    const doubles = a === b;
    // The Speed Die joins from the second round, and never for a roll to leave jail.
    const speed = config.speedDie && turn.round >= 2 && !p.inJail ? this.rollSpeed() : null;
    turn.lastRoll = dice;
    turn.lastSpeed = speed;
    turn.extraRoll = false;
    this.emit({ type: "rolled", playerId: p.id, dice, ...(speed !== null && { speed }) });

    if (p.inJail) {
      if (doubles) {
        this.leaveJail(p, "doubles");
        // Leaving jail never grants an extra roll.
        this.moveForward(p, a + b);
        return;
      }
      p.jailAttempts++;
      if (p.jailAttempts < config.maxJailTurns) return;
      this.charge(p, this.feeAccount(), config.jailFine, "jailFine", {
        kind: "leaveJailAndMove",
        steps: a + b,
      });
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
    if (speed === "patron") this.patronMove(p, a + b);
    else this.moveForward(p, a + b + (speed ?? 0));
  }

  /**
   * The Speed Die's Patron (★): after moving, carry on to the next unowned
   * property, or if none is left the next one where rent is owed, and resolve
   * only that space. Landing on Banished still banishes.
   */
  private patronMove(p: PlayerState, steps: number): void {
    const size = this.board.spaces.length;
    const landing = (p.position + steps) % size;
    if (this.board.spaces[landing]?.kind === "goToJail") {
      this.moveForward(p, steps);
      return;
    }
    const ahead = Array.from({ length: size }, (_, k) => (landing + k) % size);
    const ownable = ahead.filter((i) => {
      const space = this.board.spaces[i];
      return space !== undefined && isOwnable(space);
    });
    const target =
      ownable.find((i) => this.state.owners[i] === null) ??
      ownable.find((i) => {
        const owner = this.state.owners[i];
        return owner !== null && owner !== p.id && !this.state.sealed[i];
      }) ??
      landing;
    this.moveForward(p, steps + this.forwardDistance(landing, target));
  }

  private rollSpeed(): SpeedFace {
    if (this.options.speed !== undefined) return this.options.speed;
    let index: number;
    [index, this.state.rng] = nextInt(this.state.rng, 0, SPEED_FACES.length - 1);
    return SPEED_FACES[index] as SpeedFace;
  }

  /**
   * Chooses the next phase once everything triggered by an action has resolved:
   * debts first, then pending auctions, then the turn itself.
   */
  private settle(): void {
    const { phase, turn } = this.state;
    if (phase.kind === "gameOver" || phase.kind === "awaitingBuy" || phase.kind === "auction") {
      return;
    }
    if (this.state.debts.length > 0) {
      this.state.phase = { kind: "raisingFunds" };
      return;
    }
    while (this.state.auctionQueue.length > 0) {
      const space = this.state.auctionQueue.shift() as number;
      this.startAuction(space);
      if (this.state.phase.kind === "auction") return;
    }
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
    const { players, turn, config, finalRound } = this.state;
    let next = turn.playerIndex;
    do {
      next = (next + 1) % players.length;
    } while (players[next]?.bankrupt);
    const round = next <= turn.playerIndex ? turn.round + 1 : turn.round;
    if (config.roundLimit !== null && round > config.roundLimit) {
      this.endGame("roundLimit");
      return;
    }
    if (finalRound !== null && round > finalRound) {
      this.endGame("timeLimit");
      return;
    }
    this.state.turn = {
      playerIndex: next,
      number: turn.number + 1,
      round,
      doublesCount: 0,
      extraRoll: false,
      lastRoll: turn.lastRoll,
      lastSpeed: turn.lastSpeed,
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
        } else if (owner !== p.id && !this.state.sealed[index]) {
          this.charge(p, owner, this.rent(index, landing), "rent");
        }
        return;
      }
      case "tax":
        this.charge(p, this.feeAccount(), space.amount, "tax");
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

  private requireBuyPhase(): number {
    const { phase } = this.state;
    if (phase.kind !== "awaitingBuy") throw new Error("not deciding on a purchase");
    return phase.space;
  }

  private buy(p: PlayerState): void {
    const index = this.requireBuyPhase();
    const space = this.board.spaces[index];
    if (!space || !("price" in space)) throw new Error(`space ${index} is not for sale`);
    this.transfer(p.id, "bank", space.price, "purchase");
    this.state.owners[index] = p.id;
    this.emit({ type: "bought", playerId: p.id, space: index, price: space.price });
    this.state.phase = RESOLVING;
  }

  // ---------- Buildings ----------

  private build(p: PlayerState, index: number): void {
    const space = this.board.spaces[index];
    if (space?.kind !== "property") throw new Error(`cannot build on ${index}`);
    this.transfer(p.id, "bank", space.buildCost, "building");
    this.state.buildings[index] = nextBuildingLevel(
      this.state.config,
      this.state.buildings[index] ?? 0,
    );
    this.emit({
      type: "built",
      playerId: p.id,
      space: index,
      buildings: this.state.buildings[index] ?? 0,
    });
  }

  private sellBuilding(p: PlayerState, index: number): void {
    const space = this.board.spaces[index];
    if (space?.kind !== "property") throw new Error(`no buildings on ${index}`);
    const before = this.state.buildings[index] ?? 0;
    const after = levelAfterSale(this.state, this.board, index);
    this.state.buildings[index] = after;
    // Buildings sell back to the bank at half their cost.
    const levels = buildingRank(this.state.config, before) - buildingRank(this.state.config, after);
    this.transfer("bank", p.id, Math.floor((levels * space.buildCost) / 2), "building");
    this.emit({ type: "soldBuilding", playerId: p.id, space: index, buildings: after });
  }

  // ---------- Auctions ----------

  private startAuction(space: number): void {
    const players = this.state.players;
    const start = this.state.turn.playerIndex;
    const bidders = players
      .map((_, i) => players[(start + i) % players.length] as PlayerState)
      .filter((p) => !p.bankrupt && p.cash > 0)
      .map((p) => p.id);
    this.emit({ type: "auctionStarted", space });
    if (bidders.length === 0) {
      this.emit({ type: "auctionUnsold", space });
      return;
    }
    this.state.phase = { kind: "auction", space, highBid: 0, highBidder: null, bidders };
  }

  private bid(p: PlayerState, amount: number): void {
    const { phase } = this.state;
    if (phase.kind !== "auction") throw new Error("no auction");
    phase.highBid = amount;
    phase.highBidder = p.id;
    this.emit({ type: "bid", playerId: p.id, amount });
    this.checkAuctionEnd();
  }

  private passAuction(p: PlayerState): void {
    const { phase } = this.state;
    if (phase.kind !== "auction") throw new Error("no auction");
    phase.bidders = phase.bidders.filter((id) => id !== p.id);
    this.emit({ type: "passedAuction", playerId: p.id });
    this.checkAuctionEnd();
  }

  private checkAuctionEnd(): void {
    const { phase } = this.state;
    if (phase.kind !== "auction") return;
    if (phase.bidders.length === 0) {
      this.emit({ type: "auctionUnsold", space: phase.space });
    } else if (phase.bidders.length === 1 && phase.highBidder === phase.bidders[0]) {
      const winner = this.player(phase.highBidder);
      this.transfer(winner.id, "bank", phase.highBid, "auction");
      this.state.owners[phase.space] = winner.id;
      this.emit({
        type: "auctionWon",
        playerId: winner.id,
        space: phase.space,
        price: phase.highBid,
      });
    } else {
      return;
    }
    this.state.phase = RESOLVING;
    this.settle();
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
        this.charge(p, this.feeAccount(), effect.amount, "card");
        return;
      case "collectFromEach":
        for (const other of activePlayers(this.state)) {
          if (other.id !== p.id) this.charge(other, p.id, effect.amount, "card");
        }
        return;
      case "payEach":
        for (const other of activePlayers(this.state)) {
          if (other.id !== p.id && !p.bankrupt) this.charge(p, other.id, effect.amount, "card");
        }
        return;
      case "repairs": {
        let owed = 0;
        this.state.owners.forEach((owner, i) => {
          if (owner !== p.id) return;
          const count = this.state.buildings[i] ?? 0;
          owed += count === WALKER ? effect.perWalker : count * effect.perGuardian;
        });
        this.charge(p, this.feeAccount(), owed, "card");
        return;
      }
    }
  }

  private returnGetOutCard(deckId: DeckId): void {
    const index = DECKS[deckId].cards.findIndex((c) => c.effect.kind === "getOutOfJail");
    if (index < 0) throw new Error(`deck ${deckId} has no get-out card`);
    this.state.decks[deckId].drawPile.push(index);
  }

  // ---------- Money and debts ----------

  /** Taxes, fines and card fees feed the Soul Urn when the jackpot rule is on. */
  private feeAccount(): Account {
    return this.state.config.freeParkingJackpot ? "urn" : "bank";
  }

  private owedBy(id: PlayerId): number {
    return this.state.debts.filter((d) => d.debtor === id).reduce((sum, d) => sum + d.amount, 0);
  }

  /**
   * Collects a payment. Paid at once from cash when possible; otherwise recorded
   * as a debt the debtor must raise by selling and sealing, or immediate
   * bankruptcy when even that could not cover it.
   */
  private charge(
    debtor: PlayerState,
    creditor: Account,
    amount: number,
    reason: TransferReason,
    then?: DebtContinuation,
  ): void {
    if (debtor.bankrupt) return;
    const alreadyOwed = this.owedBy(debtor.id);
    if (alreadyOwed === 0 && debtor.cash >= amount) {
      this.transfer(debtor.id, creditor, amount, reason);
      if (then) this.continueAfterDebt(debtor, then);
      return;
    }
    if (liquidationValue(this.state, this.board, debtor.id) >= alreadyOwed + amount) {
      this.state.debts.push({ debtor: debtor.id, creditor, amount, reason, ...(then && { then }) });
      this.emit({ type: "debtOwed", debtor: debtor.id, creditor, amount });
      return;
    }
    this.bankrupt(debtor, creditor === "urn" ? "bank" : creditor);
  }

  private payDebt(): void {
    const debt = this.state.debts.shift();
    if (!debt) throw new Error("no debt to pay");
    const debtor = this.player(debt.debtor);
    this.transfer(debtor.id, debt.creditor, debt.amount, debt.reason);
    this.state.phase = RESOLVING;
    if (debt.then) this.continueAfterDebt(debtor, debt.then);
    this.settle();
  }

  private continueAfterDebt(p: PlayerState, then: DebtContinuation): void {
    switch (then.kind) {
      case "leaveJailAndMove":
        this.leaveJail(p, "fine");
        this.moveForward(p, then.steps);
        return;
    }
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
      if (this.state.urn < 0) throw new Error("transfer overdrew the urn");
      return;
    }
    const player = this.player(account);
    player.cash += delta;
    if (player.cash < 0) throw new Error(`transfer overdrew ${account}`);
  }

  private bankrupt(p: PlayerState, creditor: PlayerId | "bank"): void {
    const heir = creditor === "bank" ? null : this.player(creditor);

    this.state.owners.forEach((owner, i) => {
      if (owner !== p.id) return;
      const buildings = this.state.buildings[i] ?? 0;
      const space = this.board.spaces[i];
      if (buildings > 0 && heir && space?.kind === "property") {
        // Buildings are sold back to the bank at half price; the proceeds go to the creditor.
        const levels = buildingRank(this.state.config, buildings);
        this.transfer("bank", p.id, Math.floor((space.buildCost * levels) / 2), "bankruptcy");
      }
      this.state.buildings[i] = 0;
      if (heir) {
        // Sealed properties pass on still Sealed; the usual transfer interest is waived.
        this.state.owners[i] = heir.id;
      } else {
        // The bank cancels mortgages and auctions everything off.
        this.state.owners[i] = null;
        this.state.sealed[i] = false;
        if (this.state.config.auctions) this.state.auctionQueue.push(i);
      }
    });
    this.transfer(p.id, heir ? heir.id : "bank", p.cash, "bankruptcy");
    if (heir) heir.getOutCards.push(...p.getOutCards);
    else for (const deck of p.getOutCards) this.returnGetOutCard(deck);

    p.getOutCards = [];
    p.inJail = false;
    p.jailAttempts = 0;
    p.bankrupt = true;
    this.state.eliminationOrder.push(p.id);
    this.state.debts = this.state.debts.filter((d) => d.debtor !== p.id && d.creditor !== p.id);
    this.emit({ type: "bankrupt", playerId: p.id, creditor });

    const limit = this.state.config.bankruptciesToEnd;
    if (activePlayers(this.state).length === 1) {
      this.endGame("lastStanding");
    } else if (limit !== null && this.state.eliminationOrder.length >= limit) {
      this.endGame("bankruptcies");
    }
  }

  endGame(reason: GameOverReason): void {
    const standings = computeStandings(this.state);
    const winner = standings[0];
    if (!winner) throw new Error("no players to rank");
    this.state.debts = [];
    this.state.auctionQueue = [];
    this.state.phase = { kind: "gameOver", winnerId: winner.playerId, reason, standings };
    this.emit({ type: "gameOver", winnerId: winner.playerId, reason });
  }

  // ---------- Trades ----------

  private removeTrade(id: number): Trade {
    const trade = this.state.trades.find((t) => t.id === id);
    if (!trade) throw new Error(`no trade ${id}`);
    this.state.trades = this.state.trades.filter((t) => t.id !== id);
    return trade;
  }

  private executeTrade(id: number): void {
    const trade = this.removeTrade(id);
    const from = this.player(trade.from);
    const to = this.player(trade.to);

    const give = (giver: PlayerState, receiver: PlayerState, bundle: TradeBundle) => {
      this.transfer(giver.id, receiver.id, bundle.cash, "trade");
      for (const space of bundle.spaces) this.state.owners[space] = receiver.id;
      for (const deck of bundle.getOutCards) {
        giver.getOutCards.splice(giver.getOutCards.indexOf(deck), 1);
        receiver.getOutCards.push(deck);
      }
    };
    give(from, to, trade.offer);
    give(to, from, trade.request);

    const payInterest = (receiver: PlayerState, spaces: number[]) => {
      for (const space of spaces) {
        if (this.state.sealed[space]) {
          this.transfer(receiver.id, "bank", sealedTransferFee(this.board, space), "trade");
        }
      }
    };
    payInterest(to, trade.offer.spaces);
    payInterest(from, trade.request.spaces);
    this.emit({ type: "tradeAccepted", tradeId: id, from: from.id, to: to.id });
  }

  /** Drops offers that can no longer be executed, so players never see stale deals. */
  private pruneTrades(): void {
    for (const trade of [...this.state.trades]) {
      if (tradeProblem(this.state, this.board, trade) !== null) {
        this.removeTrade(trade.id);
        this.emit({
          type: "tradeCancelled",
          tradeId: trade.id,
          from: trade.from,
          to: trade.to,
          reason: "invalid",
        });
      }
    }
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }
}

function copyBundle(bundle: TradeBundle): TradeBundle {
  return {
    cash: bundle.cash,
    spaces: [...bundle.spaces],
    getOutCards: [...bundle.getOutCards],
  };
}
