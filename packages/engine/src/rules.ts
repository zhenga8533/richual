import {
  type BoardDefinition,
  type ColorGroup,
  groupIndices,
  indicesOfKind,
  isOwnable,
} from "./board";
import { MAX_OPEN_TRADES } from "./config";
import type { GameState, PlayerId, PlayerState, TradeBundle } from "./state";

/**
 * Pure rule queries shared by the engine, legality checks and the UI. They take
 * only the parts of the state they read, so they also work on the public view.
 */
export type EconomyView = Pick<
  GameState,
  "config" | "players" | "owners" | "buildings" | "sealed" | "trades" | "phase"
>;

export const WALKER = 5;

/** The parts of the state that turn logic needs; satisfied by the public view too. */
export type TurnView = Pick<GameState, "phase" | "players" | "turn" | "config">;

export function currentPlayer(state: TurnView): PlayerState {
  const player = state.players[state.turn.playerIndex];
  if (!player) throw new Error("turn points at a missing player");
  return player;
}

export function activePlayers(state: Pick<GameState, "players">): PlayerState[] {
  return state.players.filter((p) => !p.bankrupt);
}

/** Building levels below a Walker, plus one for the Walker itself. */
export function buildingRank(config: { guardiansPerWalker: number }, level: number): number {
  return level === WALKER ? config.guardiansPerWalker + 1 : level;
}

/** The level after building once more: Guardians up to the limit, then a Walker. */
export function nextBuildingLevel(config: { guardiansPerWalker: number }, level: number): number {
  return level >= config.guardiansPerWalker ? WALKER : level + 1;
}

export function mortgageValue(board: BoardDefinition, space: number): number {
  const s = board.spaces[space];
  return s && isOwnable(s) ? s.price / 2 : 0;
}

/** Unsealing repays the mortgage plus 10% interest. */
export function unsealCost(board: BoardDefinition, space: number): number {
  // Integer arithmetic: 50 * 1.1 is 55.000000000000007 in floating point.
  return Math.ceil((mortgageValue(board, space) * 11) / 10);
}

/** Interest due when receiving a Sealed property from another player. */
export function sealedTransferFee(board: BoardDefinition, space: number): number {
  return Math.ceil(mortgageValue(board, space) / 10);
}

export function buildingsInUse(state: Pick<GameState, "buildings">): {
  guardians: number;
  walkers: number;
} {
  let guardians = 0;
  let walkers = 0;
  for (const b of state.buildings) {
    if (b === WALKER) walkers++;
    else guardians += b;
  }
  return { guardians, walkers };
}

export function ownsGroup(
  state: Pick<GameState, "owners">,
  board: BoardDefinition,
  owner: PlayerId,
  group: ColorGroup,
): boolean {
  return groupIndices(board, group).every((i) => state.owners[i] === owner);
}

/**
 * Rent an owned space charges right now, before card multipliers. Utilities
 * charge the dice total times `diceTimes`.
 */
export function standingRent(
  state: Pick<GameState, "owners" | "buildings">,
  board: BoardDefinition,
  index: number,
): { souls: number } | { diceTimes: number } | null {
  const space = board.spaces[index];
  const owner = state.owners[index];
  if (!space || !owner) return null;
  const ownedOfKind = (kind: "zipline" | "utility") =>
    indicesOfKind(board, kind).filter((i) => state.owners[i] === owner).length;
  switch (space.kind) {
    case "property": {
      const buildings = state.buildings[index] ?? 0;
      const base = space.rent[buildings] ?? 0;
      const fullSet = ownsGroup(state, board, owner, space.group);
      return { souls: buildings === 0 && fullSet ? base * 2 : base };
    }
    case "zipline":
      return { souls: board.ziplineRent[ownedOfKind("zipline") - 1] ?? 0 };
    case "utility":
      return { diceTimes: board.utilityMultiplier[ownedOfKind("utility") - 1] ?? 0 };
    default:
      return null;
  }
}

function groupOf(board: BoardDefinition, space: number): number[] {
  const s = board.spaces[space];
  return s?.kind === "property" ? groupIndices(board, s.group) : [space];
}

function groupHasBuildings(state: EconomyView, board: BoardDefinition, space: number): boolean {
  return groupOf(board, space).some((i) => (state.buildings[i] ?? 0) > 0);
}

function findPlayer(state: Pick<GameState, "players">, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function canBuild(
  state: EconomyView,
  board: BoardDefinition,
  playerId: PlayerId,
  space: number,
): boolean {
  const s = board.spaces[space];
  const player = findPlayer(state, playerId);
  if (s?.kind !== "property" || !player || state.owners[space] !== playerId) return false;
  if (!ownsGroup(state, board, playerId, s.group)) return false;
  const group = groupIndices(board, s.group);
  if (group.some((i) => state.sealed[i])) return false;
  const level = state.buildings[space] ?? 0;
  if (level === WALKER || player.cash < s.buildCost) return false;
  const rank = (i: number) => buildingRank(state.config, state.buildings[i] ?? 0);
  if (state.config.evenBuilding && rank(space) > Math.min(...group.map(rank))) return false;
  if (state.config.limitedBuildings) {
    const inUse = buildingsInUse(state);
    if (nextBuildingLevel(state.config, level) === WALKER)
      return inUse.walkers < board.walkerSupply;
    return inUse.guardians < board.guardianSupply;
  }
  return true;
}

export function canSellBuilding(
  state: EconomyView,
  board: BoardDefinition,
  playerId: PlayerId,
  space: number,
): boolean {
  const s = board.spaces[space];
  if (s?.kind !== "property" || state.owners[space] !== playerId) return false;
  const level = state.buildings[space] ?? 0;
  if (level === 0) return false;
  if (state.config.evenBuilding) {
    const rank = (i: number) => buildingRank(state.config, state.buildings[i] ?? 0);
    return rank(space) >= Math.max(...groupIndices(board, s.group).map(rank));
  }
  return true;
}

/**
 * The building level after selling one level. A Walker normally breaks down into
 * a full row of Guardians, but only as many as the bank still has.
 */
export function levelAfterSale(state: EconomyView, board: BoardDefinition, space: number): number {
  const level = state.buildings[space] ?? 0;
  const full = state.config.guardiansPerWalker;
  if (level !== WALKER) return level - 1;
  if (!state.config.limitedBuildings) return full;
  const available = board.guardianSupply - buildingsInUse(state).guardians;
  return Math.max(0, Math.min(full, available));
}

export function canSeal(
  state: EconomyView,
  board: BoardDefinition,
  playerId: PlayerId,
  space: number,
): boolean {
  const s = board.spaces[space];
  if (!s || !isOwnable(s) || state.owners[space] !== playerId || state.sealed[space]) return false;
  return !groupHasBuildings(state, board, space);
}

export function canUnseal(
  state: EconomyView,
  board: BoardDefinition,
  playerId: PlayerId,
  space: number,
): boolean {
  const player = findPlayer(state, playerId);
  if (!player || state.owners[space] !== playerId || !state.sealed[space]) return false;
  return player.cash >= unsealCost(board, space);
}

/** Everything a player could raise right now by selling every building and sealing everything. */
export function liquidationValue(
  state: EconomyView,
  board: BoardDefinition,
  playerId: PlayerId,
): number {
  const player = findPlayer(state, playerId);
  if (!player) return 0;
  let total = player.cash;
  state.owners.forEach((owner, i) => {
    if (owner !== playerId) return;
    const s = board.spaces[i];
    if (s?.kind === "property") {
      total += Math.floor((buildingRank(state.config, state.buildings[i] ?? 0) * s.buildCost) / 2);
    }
    if (!state.sealed[i]) total += mortgageValue(board, i);
  });
  return total;
}

function bundleProblem(
  state: EconomyView,
  board: BoardDefinition,
  giver: PlayerState,
  bundle: TradeBundle,
): string | null {
  if (!Number.isInteger(bundle.cash) || bundle.cash < 0)
    return "Soul amounts must be whole and positive";
  if (bundle.cash > giver.cash) return `${giver.name} does not have ${bundle.cash} souls`;
  if (new Set(bundle.spaces).size !== bundle.spaces.length) return "A property is listed twice";
  for (const space of bundle.spaces) {
    const s = board.spaces[space];
    if (!s || !isOwnable(s)) return "Only properties, ziplines and utilities can be traded";
    if (state.owners[space] !== giver.id) return `${giver.name} does not own ${s.name}`;
    if (groupHasBuildings(state, board, space)) {
      return `Sell the buildings in ${s.name}'s set before trading it`;
    }
  }
  for (const deck of new Set(bundle.getOutCards)) {
    const offered = bundle.getOutCards.filter((d) => d === deck).length;
    const held = giver.getOutCards.filter((d) => d === deck).length;
    if (offered > held) return `${giver.name} does not hold that escape card`;
  }
  return null;
}

const isEmpty = (b: TradeBundle) =>
  b.cash === 0 && b.spaces.length === 0 && b.getOutCards.length === 0;

/** Why a trade cannot be executed right now, or null if it can. */
export function tradeProblem(
  state: EconomyView,
  board: BoardDefinition,
  trade: { from: PlayerId; to: PlayerId; offer: TradeBundle; request: TradeBundle },
): string | null {
  const from = findPlayer(state, trade.from);
  const to = findPlayer(state, trade.to);
  if (!from || !to || from.bankrupt || to.bankrupt) return "Both players must still be in the game";
  if (from.id === to.id) return "You cannot trade with yourself";
  if (isEmpty(trade.offer) && isEmpty(trade.request)) return "The trade is empty";

  const problem =
    bundleProblem(state, board, from, trade.offer) ??
    bundleProblem(state, board, to, trade.request);
  if (problem) return problem;

  // Receiving a Sealed property costs interest, payable from cash after the exchange.
  const fees = (spaces: number[]) =>
    spaces.reduce((sum, i) => sum + (state.sealed[i] ? sealedTransferFee(board, i) : 0), 0);
  const fromCashAfter = from.cash - trade.offer.cash + trade.request.cash;
  const toCashAfter = to.cash - trade.request.cash + trade.offer.cash;
  if (fromCashAfter < fees(trade.request.spaces)) {
    return `${from.name} cannot afford the interest on Sealed properties`;
  }
  if (toCashAfter < fees(trade.offer.spaces)) {
    return `${to.name} cannot afford the interest on Sealed properties`;
  }
  return null;
}

export function proposalProblem(
  state: EconomyView,
  board: BoardDefinition,
  trade: { from: PlayerId; to: PlayerId; offer: TradeBundle; request: TradeBundle },
): string | null {
  const open = state.trades.filter((t) => t.from === trade.from).length;
  if (open >= MAX_OPEN_TRADES) return `You can have at most ${MAX_OPEN_TRADES} open offers`;
  return tradeProblem(state, board, trade);
}
