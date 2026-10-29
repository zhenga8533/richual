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
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/** Open outgoing trade offers per player, so offers cannot be spammed. */
export const MAX_OPEN_TRADES = 3;
