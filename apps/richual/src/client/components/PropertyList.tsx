import {
  getBoard,
  isOwnable,
  type PublicGameState,
  type Space,
  standingRent,
  WALKER,
} from "@richual/engine";
import type { LobbyPlayer } from "@richual/protocol";
import { GROUP_COLORS, SOULS, seatColor } from "../theme";
import { Badge } from "../ui/badge";

type Section = { key: string; title: string; color: string | null; spaces: number[] };

function sections(spaces: readonly Space[]): Section[] {
  const bySet = new Map<string, Section>();
  spaces.forEach((space, index) => {
    if (!isOwnable(space)) return;
    const key = space.kind === "property" ? space.group : space.kind;
    const existing = bySet.get(key);
    if (existing) {
      existing.spaces.push(index);
      return;
    }
    bySet.set(key, {
      key,
      title: space.kind === "property" ? "" : space.kind === "zipline" ? "Ziplines" : "Utilities",
      color: space.kind === "property" ? GROUP_COLORS[space.group] : null,
      spaces: [index],
    });
  });
  const all = [...bySet.values()];
  // Sets first in board order, then ziplines and utilities.
  return [...all.filter((s) => s.color), ...all.filter((s) => !s.color)];
}

/** Every property as a list, for phones where board labels get too small to read. */
export function PropertyList({
  game,
  players,
  onSelect,
}: {
  game: PublicGameState;
  players: LobbyPlayer[];
  onSelect: (space: number) => void;
}) {
  const board = getBoard(game.config.boardId);
  let setNumber = 0;
  return (
    <div className="flex flex-col gap-3">
      {sections(board.spaces).map((section) => {
        const title = section.title || `Set ${++setNumber}`;
        return (
          <section key={section.key} aria-label={title}>
            {section.title && (
              <h3 className="px-1 pb-1 text-xs font-medium tracking-wide text-muted uppercase">
                {section.title}
              </h3>
            )}
            <ul className="overflow-hidden rounded-xl border border-line bg-surface">
              {section.spaces.map((index) => {
                const space = board.spaces[index];
                if (!space || !isOwnable(space)) return null;
                const ownerId = game.owners[index];
                const owner = ownerId ? players.find((p) => p.id === ownerId) : undefined;
                const buildings = game.buildings[index] ?? 0;
                const sealed = game.sealed[index] ?? false;
                const rent = standingRent(game, board, index);
                return (
                  <li key={index} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => onSelect(index)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-2"
                    >
                      <span
                        className="h-8 w-1.5 shrink-0 rounded-full"
                        style={{ background: section.color ?? "var(--line-strong)" }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{space.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {owner ? (
                            <span className="flex items-center gap-1">
                              <span
                                className="size-2 rounded-full"
                                style={{ background: seatColor(owner.seat) }}
                                aria-hidden
                              />
                              {owner.name}
                            </span>
                          ) : (
                            <span>
                              Unowned · {space.price} {SOULS}
                            </span>
                          )}
                          {buildings > 0 && (
                            <span className="text-accent-text">
                              {buildings === WALKER
                                ? "Walker"
                                : `${buildings} Guardian${buildings > 1 ? "s" : ""}`}
                            </span>
                          )}
                        </span>
                      </span>
                      {sealed ? (
                        <Badge variant="danger">Sealed</Badge>
                      ) : (
                        rent && (
                          <span className="text-right font-semibold tabular-nums">
                            {"souls" in rent ? (
                              <>
                                {rent.souls} <span className="text-accent-text">{SOULS}</span>
                              </>
                            ) : (
                              `dice × ${rent.diceTimes}`
                            )}
                            <span className="block text-xs font-normal text-muted">rent</span>
                          </span>
                        )
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
