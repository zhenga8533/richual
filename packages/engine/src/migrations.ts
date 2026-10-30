import { CLASSIC_RULES } from "./config";
import { computeStandings } from "./scoring";
import { type GameState, STATE_SCHEMA_VERSION } from "./state";

type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

/**
 * Upgrades from version N to N+1, indexed by N. Append-only: saved games at
 * every older version must keep loading after a deploy.
 */
const MIGRATIONS: Record<number, Migration> = {
  // v2 added sealing, auctions, debts, trades and building-supply rules.
  1: (s) => {
    const owners = s.owners as unknown[];
    return {
      ...s,
      schemaVersion: 2,
      config: {
        ...(s.config as object),
        auctions: CLASSIC_RULES.auctions,
        evenBuilding: CLASSIC_RULES.evenBuilding,
        limitedBuildings: CLASSIC_RULES.limitedBuildings,
      },
      sealed: owners.map(() => false),
      debts: [],
      auctionQueue: [],
      trades: [],
      nextTradeId: 1,
    };
  },
  // v3 added game modes, round tracking and scored endings.
  2: (s) => {
    const players = s.players as { id: string; bankrupt: boolean }[];
    const turn = s.turn as { number: number };
    const config = {
      ...(s.config as object),
      guardiansPerWalker: CLASSIC_RULES.guardiansPerWalker,
      startingProperties: CLASSIC_RULES.startingProperties,
      bankruptciesToEnd: CLASSIC_RULES.bankruptciesToEnd,
      roundLimit: CLASSIC_RULES.roundLimit,
    };
    // The order of earlier bankruptcies was not recorded; seat order stands in.
    const eliminationOrder = players.filter((p) => p.bankrupt).map((p) => p.id);
    const next: Record<string, unknown> = {
      ...s,
      schemaVersion: 3,
      config,
      turn: { ...turn, round: Math.ceil(turn.number / players.length) },
      eliminationOrder,
      finalRound: null,
    };
    const phase = s.phase as { kind: string };
    if (phase.kind === "gameOver") {
      next.phase = {
        ...phase,
        reason: "lastStanding",
        standings: computeStandings(next as unknown as GameState),
      };
    }
    return next;
  },
};

/** Brings a stored game state up to the current schema version. */
export function migrateState(stored: unknown): GameState {
  let state = stored as Record<string, unknown>;
  const storedVersion = state.schemaVersion;
  if (typeof storedVersion !== "number" || storedVersion > STATE_SCHEMA_VERSION) {
    throw new Error(`cannot load game state version ${String(storedVersion)}`);
  }
  let version = storedVersion;
  while (version < STATE_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`no migration from game state v${version}`);
    state = migrate(state);
    version = state.schemaVersion as number;
  }
  return state as GameState;
}
