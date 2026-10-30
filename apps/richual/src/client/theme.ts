import type { ColorGroup } from "@richual/engine";

/** Token colors by seat. Tokens also show hero initials, so color is never the only cue. */
export const SEAT_COLORS = ["#e0a43a", "#6b96e0", "#e0707c", "#4fb88a", "#b08ae6", "#e6dcc3"];

export const seatColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length] ?? "#ccc";

/** Desaturated "aged print" versions of the classic group colors. */
export const GROUP_COLORS: Record<ColorGroup, string> = {
  brown: "#7a4e2d",
  lightBlue: "#8fb8c9",
  pink: "#b5527a",
  orange: "#c87533",
  red: "#a83a32",
  yellow: "#c9a23a",
  green: "#4e7d4a",
  darkBlue: "#2f4c7d",
};

export const SOULS = "◈";

export function initials(name: string): string {
  const words = name.replace(/&/g, " ").split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "") : name.slice(0, 2);
  return letters.toUpperCase();
}
