import type { DeckId } from "./cards";

export type ColorGroup =
  | "brown"
  | "lightBlue"
  | "pink"
  | "orange"
  | "red"
  | "yellow"
  | "green"
  | "darkBlue";

/** Rent with 0–4 Guardians, then with a Walker. */
export type RentTable = readonly [number, number, number, number, number, number];

export type PropertySpace = {
  kind: "property";
  name: string;
  group: ColorGroup;
  price: number;
  rent: RentTable;
  buildCost: number;
};
export type ZiplineSpace = { kind: "zipline"; name: string; price: number };
export type UtilitySpace = { kind: "utility"; name: string; price: number };

export type OwnableSpace = PropertySpace | ZiplineSpace | UtilitySpace;

export type Space =
  | OwnableSpace
  | { kind: "go"; name: string }
  | { kind: "tax"; name: string; amount: number }
  | { kind: "card"; name: string; deck: DeckId }
  | { kind: "jail"; name: string }
  | { kind: "freeParking"; name: string }
  | { kind: "goToJail"; name: string };

export type BoardDefinition = {
  id: string;
  spaces: readonly Space[];
  groups: Readonly<Record<ColorGroup, { organization: string }>>;
  /** Rent by number of ziplines owned (1–4). */
  ziplineRent: readonly [number, number, number, number];
  /** Dice-total multiplier by number of utilities owned (1–2). */
  utilityMultiplier: readonly [number, number];
  /** The bank's building stock when supply is limited. */
  guardianSupply: number;
  walkerSupply: number;
};

export function isOwnable(space: Space): space is OwnableSpace {
  return space.kind === "property" || space.kind === "zipline" || space.kind === "utility";
}

const property = (
  name: string,
  group: ColorGroup,
  price: number,
  buildCost: number,
  rent: RentTable,
): PropertySpace => ({ kind: "property", name, group, price, buildCost, rent });

const oracle = { kind: "card", name: "The Oracle", deck: "oracle" } as const;
const coven = { kind: "card", name: "Coven Offering", deck: "coven" } as const;

/**
 * The default board. Economics follow the long-established classic ratios so
 * balance is proven; names follow the theme: cheap groups on the Hidden King's
 * side of the city, expensive ones uptown, ending at the Patrons themselves.
 */
export const CURSED_APPLE: BoardDefinition = {
  id: "cursed-apple",
  groups: {
    brown: { organization: "Tunnel Rats" },
    lightBlue: { organization: "Mendoza Syndicate" },
    pink: { organization: "The Seventh Moon" },
    orange: { organization: "Baxter Society" },
    red: { organization: "OSIC" },
    yellow: { organization: "Paradox Organisation" },
    green: { organization: "Uptown Society" },
    darkBlue: { organization: "The Patrons" },
  },
  ziplineRent: [25, 50, 100, 200],
  utilityMultiplier: [4, 10],
  guardianSupply: 32,
  walkerSupply: 12,
  spaces: [
    { kind: "go", name: "Astral Gate" },
    property("Rat Warrens", "brown", 60, 50, [2, 10, 30, 90, 160, 250]),
    coven,
    property("The Bear Pit", "brown", 60, 50, [4, 20, 60, 180, 320, 450]),
    { kind: "tax", name: "Patron's Tithe", amount: 200 },
    { kind: "zipline", name: "Yellow Lane Zipline", price: 200 },
    property("Harlem Numbers Den", "lightBlue", 100, 50, [6, 30, 90, 270, 400, 550]),
    oracle,
    property("Mendoza Speakeasy", "lightBlue", 100, 50, [6, 30, 90, 270, 400, 550]),
    property("East River Docks", "lightBlue", 120, 50, [8, 40, 100, 300, 450, 600]),
    { kind: "jail", name: "The Lost Whisper" },
    property("Lantern Alley", "pink", 140, 100, [10, 50, 150, 450, 625, 750]),
    { kind: "utility", name: "Fairfax Industries", price: 150 },
    property("Moonlit Teahouse", "pink", 140, 100, [10, 50, 150, 450, 625, 750]),
    property("Seventh Moon Pier", "pink", 160, 100, [12, 60, 180, 500, 700, 900]),
    { kind: "zipline", name: "Green Lane Zipline", price: 200 },
    property("Hunting Lodge", "orange", 180, 100, [14, 70, 200, 550, 750, 950]),
    coven,
    property("Trophy Hall", "orange", 180, 100, [14, 70, 200, 550, 750, 950]),
    property("Monster Morgue", "orange", 200, 100, [16, 80, 220, 600, 800, 1000]),
    { kind: "freeParking", name: "Soul Urn" },
    property("OSIC Field Office", "red", 220, 150, [18, 90, 250, 700, 875, 1050]),
    oracle,
    property("Evidence Vault", "red", 220, 150, [18, 90, 250, 700, 875, 1050]),
    property("Interrogation Wing", "red", 240, 150, [20, 100, 300, 750, 925, 1100]),
    { kind: "zipline", name: "Blue Lane Zipline", price: 200 },
    property("Paradox Museum", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]),
    property("The Clocktower", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]),
    { kind: "utility", name: "Coven Waterworks", price: 150 },
    property("Vault of Stolen Hours", "yellow", 280, 150, [24, 120, 360, 850, 1025, 1200]),
    { kind: "goToJail", name: "Banished" },
    property("Blackmore Academy", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]),
    property("Jezebel's Billiard Hall", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]),
    coven,
    property("The Baroness Hotel", "green", 320, 200, [28, 150, 450, 1000, 1200, 1400]),
    { kind: "zipline", name: "Purple Lane Zipline", price: 200 },
    oracle,
    property("Hidden King's Throne", "darkBlue", 350, 200, [35, 175, 500, 1100, 1300, 1500]),
    { kind: "tax", name: "Ritual Offering", amount: 100 },
    property("Archmother's Sanctum", "darkBlue", 400, 200, [50, 200, 600, 1400, 1700, 2000]),
  ],
};

export const BOARDS: Readonly<Record<string, BoardDefinition>> = {
  [CURSED_APPLE.id]: CURSED_APPLE,
};

export function getBoard(id: string): BoardDefinition {
  const board = BOARDS[id];
  if (!board) throw new Error(`unknown board ${id}`);
  return board;
}

export function jailIndex(board: BoardDefinition): number {
  const index = board.spaces.findIndex((s) => s.kind === "jail");
  if (index < 0) throw new Error(`board ${board.id} has no jail`);
  return index;
}

export function groupIndices(board: BoardDefinition, group: ColorGroup): number[] {
  return board.spaces.flatMap((s, i) => (s.kind === "property" && s.group === group ? [i] : []));
}

export function indicesOfKind(board: BoardDefinition, kind: Space["kind"]): number[] {
  return board.spaces.flatMap((s, i) => (s.kind === kind ? [i] : []));
}
