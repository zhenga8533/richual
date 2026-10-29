import { getBoard, isOwnable } from "./board";
import type { RuleConfig } from "./config";
import { applyAction, createGame, type NewPlayer } from "./game";
import { checkAction, getLegalActions } from "./legal";
import { nextFloat, nextInt, type RngState, seedRng } from "./rng";
import { activePlayers } from "./rules";
import type { Action, GameEvent, GameState, PlayerId } from "./state";

/** Picks an action for `playerId`, using its own RNG so play stays reproducible. */
export type Policy = (
  state: GameState,
  playerId: PlayerId,
  legal: readonly Action[],
  rng: RngState,
) => [action: Action, next: RngState];

function pick<T>(items: readonly T[], rng: RngState): [T, RngState] {
  const [i, next] = nextInt(rng, 0, items.length - 1);
  const item = items[i];
  if (item === undefined) throw new Error("pick from an empty list");
  return [item, next];
}

/** Proposes selling one random tradable property to a random opponent at its printed price. */
function randomTradeOffer(
  state: GameState,
  playerId: PlayerId,
  rng: RngState,
): [Action | null, RngState] {
  const board = getBoard(state.config.boardId);
  const mine = state.owners.flatMap((o, i) => (o === playerId ? [i] : []));
  const others = activePlayers(state).filter((p) => p.id !== playerId);
  if (mine.length === 0 || others.length === 0) return [null, rng];
  let space: number;
  let to: (typeof others)[number];
  [space, rng] = pick(mine, rng);
  [to, rng] = pick(others, rng);
  const s = board.spaces[space];
  const price = s && isOwnable(s) ? s.price : 0;
  const action: Action = {
    type: "proposeTrade",
    to: to.id,
    offer: { cash: 0, spaces: [space], getOutCards: [] },
    request: { cash: Math.min(price, to.cash), spaces: [], getOutCards: [] },
  };
  return [checkAction(state, playerId, action) ? null : action, rng];
}

/**
 * A plausible but careless player: buys most things, builds when it can, raises
 * funds before giving up, bids a little in auctions and dabbles in trades.
 */
export const randomPolicy: Policy = (state, playerId, legal, rng) => {
  const of = <T extends Action["type"]>(type: T) =>
    legal.filter((a): a is Extract<Action, { type: T }> => a.type === type);
  let f: number;
  [f, rng] = nextFloat(rng);

  const pay = of("payDebt")[0];
  if (pay) return [pay, rng];
  if (of("declareBankruptcy").length > 0) {
    const raise = [...of("sellBuilding"), ...of("seal")];
    if (raise.length > 0) return pick(raise, rng);
    return [{ type: "declareBankruptcy" }, rng];
  }

  const bid = of("bid")[0];
  const passAuction = of("passAuction")[0];
  if (bid || passAuction) {
    const cash = state.players.find((p) => p.id === playerId)?.cash ?? 0;
    if (bid && (f < 0.5 || !passAuction)) {
      let extra: number;
      [extra, rng] = nextInt(rng, 0, 30);
      return [{ type: "bid", amount: Math.min(cash, bid.amount + extra) }, rng];
    }
    if (passAuction) return [passAuction, rng];
  }

  const responses = [...of("acceptTrade"), ...of("rejectTrade")];
  if (responses.length > 0 && f < 0.5) return pick(responses, rng);

  if (of("buy").length > 0) return [f < 0.85 ? { type: "buy" } : { type: "decline" }, rng];

  const builds = of("build");
  if (builds.length > 0 && f < 0.5) return pick(builds, rng);
  const unseals = of("unseal");
  if (unseals.length > 0 && f < 0.15) return pick(unseals, rng);

  if (of("endTurn").length > 0 && f > 0.97) {
    let offer: Action | null;
    [offer, rng] = randomTradeOffer(state, playerId, rng);
    if (offer) return [offer, rng];
  }

  const flow = legal.filter((a) =>
    ["roll", "payJailFine", "useGetOutCard", "decline", "endTurn"].includes(a.type),
  );
  if (flow.length > 0) return pick(flow, rng);
  return pick(legal, rng);
};

/** Players who have something to decide, ignoring offers they could merely withdraw. */
function actors(state: GameState): PlayerId[] {
  const { phase } = state;
  return state.players
    .filter((p) => {
      const legal = getLegalActions(state, p.id).filter((a) => a.type !== "cancelTrade");
      if (legal.length === 0) return false;
      // The high bidder only waits for others; letting it raise its own bid forever stalls.
      if (phase.kind === "auction" && phase.highBidder === p.id && phase.bidders.length > 1) {
        return legal.some((a) => a.type === "acceptTrade" || a.type === "rejectTrade");
      }
      return true;
    })
    .map((p) => p.id);
}

export type SimulationStep = {
  before: GameState;
  after: GameState;
  playerId: PlayerId;
  action: Action;
  events: GameEvent[];
};

export type SimulationOptions = {
  players: readonly NewPlayer[];
  rules: RuleConfig;
  seed: number;
  /** Stop after this many turns even if nobody has won. */
  maxTurns: number;
  policy?: Policy;
  onStep?: (step: SimulationStep) => void;
};

export type SimulationResult = {
  finished: boolean;
  turns: number;
  actions: { playerId: PlayerId; action: Action }[];
  initial: GameState;
  final: GameState;
};

/** Plays a whole game with `policy` choosing every action. Used for invariant testing and balance tuning. */
export function simulateGame(options: SimulationOptions): SimulationResult {
  const { players, rules, seed, maxTurns, policy = randomPolicy, onStep } = options;
  const initial = createGame(players, rules, seed);
  let state = initial;
  let rng = seedRng(seed ^ 0x5bd1e995);
  const actions: SimulationResult["actions"] = [];

  while (state.phase.kind !== "gameOver" && state.turn.number <= maxTurns) {
    const candidates = actors(state);
    if (candidates.length === 0) throw new Error(`nobody can act in phase ${state.phase.kind}`);
    let playerId: PlayerId;
    [playerId, rng] = pick(candidates, rng);
    let action: Action;
    [action, rng] = policy(state, playerId, getLegalActions(state, playerId), rng);

    const result = applyAction(state, playerId, action);
    if (!result.ok) {
      throw new Error(`policy action ${action.type} was rejected: ${result.error.message}`);
    }
    actions.push({ playerId, action });
    onStep?.({ before: state, after: result.state, playerId, action, events: result.events });
    state = result.state;
  }

  return {
    finished: state.phase.kind === "gameOver",
    turns: state.turn.number,
    actions,
    initial,
    final: state,
  };
}

/** Re-applies a recorded action log; must reproduce the original final state exactly. */
export function replay(initial: GameState, actions: SimulationResult["actions"]): GameState {
  let state = initial;
  for (const { playerId, action } of actions) {
    const result = applyAction(state, playerId, action);
    if (!result.ok) throw new Error(`replay diverged: ${result.error.message}`);
    state = result.state;
  }
  return state;
}
