import type { RuleConfig } from "./config";
import { applyAction, createGame, currentPlayer, getLegalActions, type NewPlayer } from "./game";
import { nextFloat, nextInt, type RngState, seedRng } from "./rng";
import type { Action, GameEvent, GameState, PlayerId } from "./state";

/** Picks an action from the legal ones, using its own RNG so play stays reproducible. */
export type Policy = (
  state: GameState,
  legal: readonly Action[],
  rng: RngState,
) => [action: Action, next: RngState];

/** Buys most of what it lands on, otherwise acts uniformly at random. */
export const randomPolicy: Policy = (_state, legal, rng) => {
  const canBuy = legal.some((a) => a.type === "buy");
  if (canBuy) {
    const [f, next] = nextFloat(rng);
    if (f < 0.85) return [{ type: "buy" }, next];
    return [{ type: "decline" }, next];
  }
  const [i, next] = nextInt(rng, 0, legal.length - 1);
  const action = legal[i];
  if (!action) throw new Error("policy called with no legal actions");
  return [action, next];
};

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
  let policyRng = seedRng(seed ^ 0x5bd1e995);
  const actions: SimulationResult["actions"] = [];

  while (state.phase.kind !== "gameOver" && state.turn.number <= maxTurns) {
    const playerId = currentPlayer(state).id;
    const legal = getLegalActions(state, playerId);
    if (legal.length === 0) throw new Error(`no legal actions in phase ${state.phase.kind}`);
    let action: Action;
    [action, policyRng] = policy(state, legal, policyRng);

    const result = applyAction(state, playerId, action);
    if (!result.ok) {
      throw new Error(`legal action ${action.type} was rejected: ${result.error.message}`);
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
