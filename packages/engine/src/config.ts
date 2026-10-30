export type RuleConfig = {
  boardId: string;
  startingCash: number;
  goSalary: number;
  /** House rule: landing exactly on the Astral Gate pays double salary. */
  doubleOnExactGo: boolean;
  /** House rule: taxes and fines feed the Soul Urn; landing on it collects the pot. */
  freeParkingJackpot: boolean;
  jailFine: number;
  /** Failed doubles attempts before the fine is forced. */
  maxJailTurns: number;
  /** Declined purchases and bankrupt players' holdings go to auction. */
  auctions: boolean;
  /** Guardians must be built and sold evenly across a color set. */
  evenBuilding: boolean;
  /** The bank's Guardian and Walker supply is finite (see the board definition). */
  limitedBuildings: boolean;
  /** Guardians needed on a property before it can be upgraded to a Walker. */
  guardiansPerWalker: number;
  /** Random properties dealt to (and paid for by) each player at the start. */
  startingProperties: number;
  /**
   * The game ends, scored by net worth, once this many players are bankrupt.
   * Null plays on until one player remains.
   */
  bankruptciesToEnd: number | null;
  /** The game ends, scored by net worth, after this many full rounds. */
  roundLimit: number | null;
  /** A third die from round 2 on: adds 1–3 to the move, or sends you on to the next unowned property. */
  speedDie: boolean;
};

export const CLASSIC_RULES: RuleConfig = {
  boardId: "cursed-apple",
  startingCash: 1500,
  goSalary: 200,
  doubleOnExactGo: true,
  freeParkingJackpot: true,
  jailFine: 50,
  maxJailTurns: 3,
  auctions: true,
  evenBuilding: true,
  limitedBuildings: true,
  guardiansPerWalker: 4,
  startingProperties: 0,
  bankruptciesToEnd: null,
  roundLimit: null,
  speedDie: false,
};

/**
 * Shorter games, adapted from the classic short-game rules: properties are dealt
 * at the start, Walkers come sooner, house-rule cash injections are off, and the
 * game is scored as soon as the second player goes bankrupt.
 */
export const QUICK_RULES: RuleConfig = {
  ...CLASSIC_RULES,
  doubleOnExactGo: false,
  freeParkingJackpot: false,
  guardiansPerWalker: 3,
  startingProperties: 2,
  bankruptciesToEnd: 2,
  speedDie: true,
};

export const MODES = { classic: CLASSIC_RULES, quick: QUICK_RULES } as const;
export type ModeId = keyof typeof MODES;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/** Open outgoing trade offers per player, so offers cannot be spammed. */
export const MAX_OPEN_TRADES = 3;
