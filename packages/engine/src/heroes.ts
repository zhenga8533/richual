/** Heroes players can claim as their token. Cosmetic only: names, no official art. */
export const HEROES = [
  { id: "abrams", name: "Abrams" },
  { id: "bebop", name: "Bebop" },
  { id: "dynamo", name: "Dynamo" },
  { id: "grey-talon", name: "Grey Talon" },
  { id: "haze", name: "Haze" },
  { id: "infernus", name: "Infernus" },
  { id: "ivy", name: "Ivy" },
  { id: "kelvin", name: "Kelvin" },
  { id: "lady-geist", name: "Lady Geist" },
  { id: "lash", name: "Lash" },
  { id: "mcginnis", name: "McGinnis" },
  { id: "mirage", name: "Mirage" },
  { id: "mo-krill", name: "Mo & Krill" },
  { id: "paradox", name: "Paradox" },
  { id: "pocket", name: "Pocket" },
  { id: "seven", name: "Seven" },
  { id: "shiv", name: "Shiv" },
  { id: "vindicta", name: "Vindicta" },
  { id: "viscous", name: "Viscous" },
  { id: "warden", name: "Warden" },
  { id: "wraith", name: "Wraith" },
  { id: "yamato", name: "Yamato" },
] as const;

export type HeroId = (typeof HEROES)[number]["id"];

export const HERO_IDS = HEROES.map((h) => h.id) as [HeroId, ...HeroId[]];

export function heroName(id: string): string {
  return HEROES.find((h) => h.id === id)?.name ?? id;
}
