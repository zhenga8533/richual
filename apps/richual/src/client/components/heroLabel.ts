import { heroName } from "@richual/engine";

/** The hero's name, or the player's own name if they have no hero. */
export function heroLabel(hero: string | null, fallback: string): string {
  return hero ? heroName(hero) : fallback;
}
