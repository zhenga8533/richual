import type { DeckId } from "./cards";
import type { GameState } from "./state";

/** What clients may see: deck order and the RNG state would let a client predict draws and dice. */
export type PublicGameState = Omit<GameState, "decks" | "rng"> & {
  decks: Record<DeckId, { remaining: number }>;
};

export function toPublicState(state: GameState): PublicGameState {
  const { decks, rng: _rng, ...rest } = state;
  return {
    ...rest,
    decks: {
      oracle: { remaining: decks.oracle.drawPile.length },
      coven: { remaining: decks.coven.drawPile.length },
    },
  };
}
