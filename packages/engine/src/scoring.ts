import { type BoardDefinition, getBoard, isOwnable } from "./board";
import { buildingRank } from "./rules";
import type { GameState, PlayerId, Standing } from "./state";

type ScoringView = Pick<
  GameState,
  "config" | "players" | "owners" | "buildings" | "sealed" | "eliminationOrder"
>;

/** A player's net worth, itemised so the score screen can show how it adds up. */
export function netWorth(
  state: ScoringView,
  board: BoardDefinition,
  playerId: PlayerId,
): Omit<Standing, "playerId" | "rank" | "bankrupt"> {
  const cash = state.players.find((p) => p.id === playerId)?.cash ?? 0;
  let propertyValue = 0;
  let buildingValue = 0;
  state.owners.forEach((owner, i) => {
    const space = board.spaces[i];
    if (owner !== playerId || !space || !isOwnable(space)) return;
    propertyValue += state.sealed[i] ? space.price / 2 : space.price;
    if (space.kind === "property") {
      buildingValue += buildingRank(state.config, state.buildings[i] ?? 0) * space.buildCost;
    }
  });
  return { cash, propertyValue, buildingValue, netWorth: cash + propertyValue + buildingValue };
}

/**
 * Final ranking: players still in the game by net worth (then cash, then seat),
 * followed by bankrupt players, the last to fall ranking highest.
 */
export function computeStandings(state: ScoringView): Standing[] {
  const board = getBoard(state.config.boardId);
  const active = state.players
    .map((p, seat) => ({ p, seat, worth: netWorth(state, board, p.id) }))
    .filter(({ p }) => !p.bankrupt)
    .sort(
      (x, y) =>
        y.worth.netWorth - x.worth.netWorth || y.worth.cash - x.worth.cash || x.seat - y.seat,
    );
  const fallen = [...state.eliminationOrder].reverse();

  return [
    ...active.map(({ p, worth }) => ({ playerId: p.id, bankrupt: false, ...worth })),
    ...fallen.map((id) => ({
      playerId: id,
      bankrupt: true,
      cash: 0,
      propertyValue: 0,
      buildingValue: 0,
      netWorth: 0,
    })),
  ].map((standing, i) => ({ ...standing, rank: i + 1 }));
}
