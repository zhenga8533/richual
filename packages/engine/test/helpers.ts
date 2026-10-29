import { expect } from "vitest";
import { DECKS, type DeckId } from "../src/cards";
import { CLASSIC_RULES, type RuleConfig } from "../src/config";
import { applyAction, createGame } from "../src/game";
import type { Action, GameEvent, GameState, PlayerId } from "../src/state";

export const IDS = ["a", "b", "c", "d", "e", "f"] as const;

/** A game whose turn order is a, b, c… regardless of the seed's shuffle. */
export function newGame(players = 2, rules: Partial<RuleConfig> = {}): GameState {
  const state = createGame(
    IDS.slice(0, players).map((id) => ({ id, name: id.toUpperCase() })),
    { ...CLASSIC_RULES, ...rules },
    1,
  );
  state.players.sort((x, y) => x.id.localeCompare(y.id));
  return state;
}

export function act(
  state: GameState,
  playerId: PlayerId,
  action: Action["type"],
  dice?: readonly [number, number],
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, playerId, { type: action } as Action, dice ? { dice } : {});
  if (!result.ok) throw new Error(`${action} by ${playerId} failed: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Rolls `dice` for the current player. */
export function roll(state: GameState, dice: readonly [number, number]) {
  const player = state.players[state.turn.playerIndex];
  if (!player) throw new Error("no current player");
  return act(state, player.id, "roll", dice);
}

export function player(state: GameState, id: PlayerId) {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

/** Puts the named card on top of its deck. */
export function stackCard(state: GameState, deck: DeckId, cardId: string): void {
  const index = DECKS[deck].cards.findIndex((c) => c.id === cardId);
  expect(index).toBeGreaterThanOrEqual(0);
  const pile = state.decks[deck].drawPile;
  pile.splice(pile.indexOf(index), 1);
  pile.unshift(index);
}

export function own(state: GameState, id: PlayerId, ...spaces: number[]): void {
  for (const s of spaces) state.owners[s] = id;
}

export function totalCash(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.cash, 0) + state.urn;
}
