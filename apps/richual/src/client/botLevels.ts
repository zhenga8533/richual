import type { BotLevel } from "@richual/engine";

export const BOT_LEVEL_OPTIONS: { level: BotLevel; label: string; hint: string }[] = [
  { level: "easy", label: "Easy", hint: "Cautious, never haggles" },
  { level: "normal", label: "Normal", hint: "Steady and fair" },
  { level: "hard", label: "Hard", hint: "Builds fast, guards its sets, trades hard" },
];

export const botLevelLabel = (level: BotLevel | null) =>
  BOT_LEVEL_OPTIONS.find((o) => o.level === level)?.label ?? "Normal";
