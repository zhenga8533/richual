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
};

export const CLASSIC_RULES: RuleConfig = {
  boardId: "cursed-apple",
  startingCash: 1500,
  goSalary: 200,
  doubleOnExactGo: true,
  freeParkingJackpot: true,
  jailFine: 50,
  maxJailTurns: 3,
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
