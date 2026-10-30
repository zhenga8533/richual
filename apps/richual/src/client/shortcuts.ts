import { type Action, getLegalActions, type PublicGameState } from "@richual/engine";
import { useEffect } from "react";
import { sendAction } from "./connection";

export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: "Space / Enter", does: "Main action: roll, buy, end turn or pay a debt" },
  { keys: "R", does: "Roll dice" },
  { keys: "B", does: "Buy the property you landed on" },
  { keys: "P", does: "Pass on a purchase, or drop out of an auction" },
  { keys: "E", does: "End your turn" },
  { keys: "1 – 4", does: "Players, Trades, Log or Chat tab" },
  { keys: "?", does: "Show or hide these shortcuts" },
];

/** The action the big button does right now, if any. Bids need a choice, so they never count. */
export function primaryAction(legal: readonly Action[]): Action | null {
  for (const type of ["payDebt", "roll", "buy", "endTurn"] as const) {
    const action = legal.find((a) => a.type === type);
    if (action) return action;
  }
  return null;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** The board uses keys to move between spaces, so game shortcuts stay out of its way. */
function onBoard(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("[data-board]") !== null;
}

export function useShortcuts({
  game,
  playerId,
  paused,
  pending,
  onTab,
  onToggleHelp,
}: {
  game: PublicGameState;
  playerId: string | null;
  paused: boolean;
  pending: boolean;
  onTab: (index: number) => void;
  onToggleHelp: () => void;
}): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || onBoard(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        onToggleHelp();
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        onTab(Number(e.key) - 1);
        return;
      }
      if (!playerId || paused || pending) return;
      const legal = getLegalActions(game, playerId);
      const find = (...types: Action["type"][]) => legal.find((a) => types.includes(a.type));
      let action: Action | null | undefined;
      switch (e.key.toLowerCase()) {
        case " ":
        case "enter":
          // A focused button already handles Space and Enter itself.
          if (e.target instanceof HTMLButtonElement) return;
          action = primaryAction(legal);
          break;
        case "r":
          action = find("roll");
          break;
        case "b":
          action = find("buy");
          break;
        case "p":
          action = find("decline", "passAuction");
          break;
        case "e":
          action = find("endTurn");
          break;
        default:
          return;
      }
      if (action) {
        e.preventDefault();
        sendAction(action);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, playerId, paused, pending, onTab, onToggleHelp]);
}
