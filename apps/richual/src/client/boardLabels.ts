/**
 * Shorter names for cramped board cells. Display only: the full name stays in
 * the tooltip, the accessible label and the details popover.
 */
const SHORT_NAMES: Record<string, string> = {
  "Jezebel's Billiard Hall": "Jezebel's",
  "Vault of Stolen Hours": "Stolen Hours",
  "Hidden King's Throne": "King's Throne",
  "Archmother's Sanctum": "Sanctum",
  "The Baroness Hotel": "Baroness",
  "Interrogation Wing": "Interrogation",
  "Harlem Numbers Den": "Numbers Den",
  "Seventh Moon Pier": "Moon Pier",
  "OSIC Field Office": "OSIC Office",
  "Mendoza Speakeasy": "Speakeasy",
  "Blackmore Academy": "Blackmore",
  "Moonlit Teahouse": "Teahouse",
  "East River Docks": "River Docks",
  "Paradox Museum": "Paradox",
  "Monster Morgue": "Morgue",
  "Evidence Vault": "Evidence",
  "Hunting Lodge": "Lodge",
  "The Clocktower": "Clocktower",
  "Yellow Lane Zipline": "Yellow Zip",
  "Green Lane Zipline": "Green Zip",
  "Blue Lane Zipline": "Blue Zip",
  "Purple Lane Zipline": "Purple Zip",
  "Fairfax Industries": "Fairfax",
  "Coven Waterworks": "Waterworks",
  "Patron's Tithe": "Tithe",
  "Ritual Offering": "Offering",
  "Coven Offering": "Coven",
  "The Oracle": "Oracle",
  "The Bear Pit": "Bear Pit",
};

export const shortName = (name: string) => SHORT_NAMES[name] ?? name;
