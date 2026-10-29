export type DeckId = "oracle" | "coven";

export type CardEffect =
  /** Move forward to a space, collecting salary if the Astral Gate is passed. */
  | { kind: "advanceTo"; space: number }
  /** Move forward to the nearest zipline or utility; if owned, pay a special rent. */
  | { kind: "advanceToNearest"; target: "zipline" | "utility" }
  | { kind: "moveBy"; steps: number }
  | { kind: "goToJail" }
  | { kind: "getOutOfJail" }
  | { kind: "collect"; amount: number }
  | { kind: "pay"; amount: number }
  | { kind: "collectFromEach"; amount: number }
  | { kind: "payEach"; amount: number }
  | { kind: "repairs"; perGuardian: number; perWalker: number };

export type Card = { id: string; text: string; effect: CardEffect };

export type DeckDefinition = { id: DeckId; name: string; cards: readonly Card[] };

/** Headlines from the New York Oracle: mostly movement and events. */
export const ORACLE_DECK: DeckDefinition = {
  id: "oracle",
  name: "The Oracle",
  cards: [
    {
      id: "oracle-gate",
      text: "ASTRAL GATE SURGES AT DAWN. Advance to the Astral Gate and collect your souls.",
      effect: { kind: "advanceTo", space: 0 },
    },
    {
      id: "oracle-interrogation",
      text: "OSIC SEEKS WITNESSES. Report to the Interrogation Wing.",
      effect: { kind: "advanceTo", space: 24 },
    },
    {
      id: "oracle-lantern",
      text: "LANTERNS LIT ON MOTT STREET. Advance to Lantern Alley.",
      effect: { kind: "advanceTo", space: 11 },
    },
    {
      id: "oracle-sanctum",
      text: "ARCHMOTHER GRANTS AUDIENCE. Advance to the Archmother's Sanctum.",
      effect: { kind: "advanceTo", space: 39 },
    },
    {
      id: "oracle-yellow-zip",
      text: "YELLOW LANE LINE REOPENS. Take a ride on the Yellow Lane Zipline.",
      effect: { kind: "advanceTo", space: 5 },
    },
    {
      id: "oracle-nearest-zip-1",
      text: "STREETS FLOODED WITH THRALLS. Ride to the nearest zipline. If owned, pay double fare.",
      effect: { kind: "advanceToNearest", target: "zipline" },
    },
    {
      id: "oracle-nearest-zip-2",
      text: "WALKER SIGHTED MIDTOWN. Ride to the nearest zipline. If owned, pay double fare.",
      effect: { kind: "advanceToNearest", target: "zipline" },
    },
    {
      id: "oracle-nearest-utility",
      text: "CITYWIDE BLACKOUT. Advance to the nearest utility. If owned, roll and pay ten times the total.",
      effect: { kind: "advanceToNearest", target: "utility" },
    },
    {
      id: "oracle-back-three",
      text: "TIME SLIPS IN THE PARADOX MUSEUM. Go back three spaces.",
      effect: { kind: "moveBy", steps: -3 },
    },
    {
      id: "oracle-banished",
      text: "MUNICIPAL COVEN ISSUES WARRANT. Banished to the Lost Whisper. Do not pass the Gate.",
      effect: { kind: "goToJail" },
    },
    {
      id: "oracle-free",
      text: "A FRIEND IN THE TUNNELS. Escape the Lost Whisper once. Keep this until used.",
      effect: { kind: "getOutOfJail" },
    },
    {
      id: "oracle-dividend",
      text: "FAIRFAX SHARES SOAR. Collect a dividend of 50 souls.",
      effect: { kind: "collect", amount: 50 },
    },
    {
      id: "oracle-loan",
      text: "YOUR SOUL BOND MATURES. Collect 150 souls.",
      effect: { kind: "collect", amount: 150 },
    },
    {
      id: "oracle-fine",
      text: "CAUGHT RACING A ZIPLINE. Pay a 15 soul fine.",
      effect: { kind: "pay", amount: 15 },
    },
    {
      id: "oracle-chairman",
      text: "ELECTED HEAD OF THE BAXTER SOCIETY. Pay each player 50 souls.",
      effect: { kind: "payEach", amount: 50 },
    },
    {
      id: "oracle-repairs",
      text: "SHRINE DESECRATED IN THE NIGHT. Pay 25 per Guardian and 100 per Walker you own.",
      effect: { kind: "repairs", perGuardian: 25, perWalker: 100 },
    },
  ],
};

/** Decrees of the Municipal Coven: mostly fees and windfalls. */
export const COVEN_DECK: DeckDefinition = {
  id: "coven",
  name: "Coven Offering",
  cards: [
    {
      id: "coven-gate",
      text: "The Coven opens a gate for you. Advance to the Astral Gate and collect your souls.",
      effect: { kind: "advanceTo", space: 0 },
    },
    {
      id: "coven-error",
      text: "The Coven ledger errs in your favor. Collect 200 souls.",
      effect: { kind: "collect", amount: 200 },
    },
    {
      id: "coven-healer",
      text: "A street healer mends your curse. Pay 50 souls.",
      effect: { kind: "pay", amount: 50 },
    },
    {
      id: "coven-relic",
      text: "You sell a relic to the Paradox Museum. Collect 50 souls.",
      effect: { kind: "collect", amount: 50 },
    },
    {
      id: "coven-free",
      text: "The Coven vouches for you. Escape the Lost Whisper once. Keep this until used.",
      effect: { kind: "getOutOfJail" },
    },
    {
      id: "coven-banished",
      text: "Caught trafficking unlicensed souls. Banished to the Lost Whisper. Do not pass the Gate.",
      effect: { kind: "goToJail" },
    },
    {
      id: "coven-festival",
      text: "The Lantern Festival fund pays out. Collect 100 souls.",
      effect: { kind: "collect", amount: 100 },
    },
    {
      id: "coven-tithe-refund",
      text: "Your Patron's Tithe is refunded. Collect 20 souls.",
      effect: { kind: "collect", amount: 20 },
    },
    {
      id: "coven-birthday",
      text: "It is your summoning day. Collect 10 souls from every player.",
      effect: { kind: "collectFromEach", amount: 10 },
    },
    {
      id: "coven-insurance",
      text: "Your afterlife insurance matures. Collect 100 souls.",
      effect: { kind: "collect", amount: 100 },
    },
    {
      id: "coven-exorcism",
      text: "An exorcist's bill arrives. Pay 100 souls.",
      effect: { kind: "pay", amount: 100 },
    },
    {
      id: "coven-academy",
      text: "Blackmore Academy tuition is due. Pay 50 souls.",
      effect: { kind: "pay", amount: 50 },
    },
    {
      id: "coven-consult",
      text: "The Baxter Society pays for your expertise. Collect 25 souls.",
      effect: { kind: "collect", amount: 25 },
    },
    {
      id: "coven-wards",
      text: "Wards must be renewed. Pay 40 per Guardian and 115 per Walker you own.",
      effect: { kind: "repairs", perGuardian: 40, perWalker: 115 },
    },
    {
      id: "coven-seance",
      text: "Second prize in the Baroness Hotel séance contest. Collect 10 souls.",
      effect: { kind: "collect", amount: 10 },
    },
    {
      id: "coven-inheritance",
      text: "A distant spirit leaves you its hoard. Collect 100 souls.",
      effect: { kind: "collect", amount: 100 },
    },
  ],
};

export const DECKS: Readonly<Record<DeckId, DeckDefinition>> = {
  oracle: ORACLE_DECK,
  coven: COVEN_DECK,
};
