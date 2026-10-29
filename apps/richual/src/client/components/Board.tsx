import { getBoard, isOwnable, type PublicGameState, type Space, WALKER } from "@richual/engine";
import type { LobbyPlayer } from "@richual/protocol";
import { GROUP_COLORS, initials, SOULS, seatColor } from "../theme";
import { heroLabel } from "./heroLabel";

/** Grid cell for a space index on an 11×11 board, starting at the bottom-right corner. */
function cellFor(index: number): { row: number; col: number } {
  if (index <= 10) return { row: 11, col: 11 - index };
  if (index <= 20) return { row: 21 - index, col: 1 };
  if (index <= 30) return { row: 1, col: index - 19 };
  return { row: index - 29, col: 11 };
}

type Props = {
  game: PublicGameState;
  players: LobbyPlayer[];
  myId: string | null;
  selected: number | null;
  onSelect: (space: number) => void;
};

export function Board({ game, players, myId, selected, onSelect }: Props) {
  const board = getBoard(game.config.boardId);
  const seatOf = (id: string) => players.find((p) => p.id === id)?.seat ?? 0;
  const lobbyPlayer = (id: string) => players.find((p) => p.id === id);
  const current = game.players[game.turn.playerIndex];

  return (
    <div
      className="grid aspect-square w-full gap-px rounded-sm border border-brass-dim bg-brass-dim/40 p-px"
      style={{
        gridTemplateColumns: "1.5fr repeat(9, 1fr) 1.5fr",
        gridTemplateRows: "1.5fr repeat(9, 1fr) 1.5fr",
      }}
    >
      {board.spaces.map((space, index) => {
        const { row, col } = cellFor(index);
        const owner = game.owners[index];
        const here = game.players.filter((p) => !p.bankrupt && p.position === index);
        return (
          <SpaceCell
            // biome-ignore lint/suspicious/noArrayIndexKey: board spaces are fixed and identified by index
            key={index}
            space={space}
            row={row}
            col={col}
            ownerColor={owner ? seatColor(seatOf(owner)) : null}
            ownerName={owner ? (lobbyPlayer(owner)?.name ?? "") : null}
            buildings={game.buildings[index] ?? 0}
            sealed={game.sealed[index] ?? false}
            selected={selected === index}
            onSelect={() => onSelect(index)}
            tokens={here.map((p) => ({
              id: p.id,
              name: p.name,
              label: initials(heroLabel(lobbyPlayer(p.id)?.hero ?? null, p.name)),
              color: seatColor(seatOf(p.id)),
              jailed: p.inJail,
              mine: p.id === myId,
            }))}
          />
        );
      })}

      <div
        className="flex flex-col items-center justify-center gap-3 bg-smoke p-4 text-center"
        style={{ gridRow: "2 / 11", gridColumn: "2 / 11" }}
      >
        <p className="font-display text-3xl tracking-wide text-brass sm:text-5xl">Richual</p>
        <Dice roll={game.turn.lastRoll} />
        {current && (
          <p className="text-sm text-parchment-dim">
            Turn {game.turn.number}: <span className="text-parchment">{current.name}</span>
          </p>
        )}
        {game.config.freeParkingJackpot && (
          <p className="text-sm text-parchment-dim">
            Soul Urn:{" "}
            <span className="tabular-nums text-amber">
              {game.urn} {SOULS}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

type Token = {
  id: string;
  name: string;
  label: string;
  color: string;
  jailed: boolean;
  mine: boolean;
};

function SpaceCell({
  space,
  row,
  col,
  ownerColor,
  ownerName,
  buildings,
  sealed,
  selected,
  onSelect,
  tokens,
}: {
  space: Space;
  row: number;
  col: number;
  ownerColor: string | null;
  ownerName: string | null;
  buildings: number;
  sealed: boolean;
  selected: boolean;
  onSelect: () => void;
  tokens: Token[];
}) {
  const band = space.kind === "property" ? GROUP_COLORS[space.group] : null;
  const description = [
    space.name,
    "price" in space ? `price ${space.price} ${SOULS}` : null,
    ownerName ? `owned by ${ownerName}` : null,
    sealed ? "sealed" : null,
    tokens.length ? `here: ${tokens.map((t) => t.name).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-smoke-light/90 text-left text-[clamp(6px,0.75vw,11px)] leading-tight hover:bg-smoke-light ${
        selected ? "z-10 outline-2 outline-amber" : ""
      } ${sealed ? "opacity-60" : ""}`}
      style={{
        gridRow: row,
        gridColumn: col,
        boxShadow: ownerColor ? `inset 0 -4px 0 ${ownerColor}` : undefined,
      }}
      title={description}
      aria-label={description}
    >
      {band && <div className="h-[18%] shrink-0" style={{ background: band }} />}
      <div className="flex flex-1 flex-col items-center justify-between p-0.5 text-center">
        <span className="line-clamp-3 text-parchment">{space.name}</span>
        {buildings > 0 && (
          <span className="text-amber">
            {buildings === WALKER ? "Walker" : "▲".repeat(buildings)}
          </span>
        )}
        {sealed && <span className="text-blood">Sealed</span>}
        {isOwnable(space) && !ownerColor && (
          <span className="tabular-nums text-parchment-dim">
            {space.price}
            {SOULS}
          </span>
        )}
      </div>
      {tokens.length > 0 && (
        <div className="absolute inset-x-0 bottom-1 flex flex-wrap justify-center gap-0.5">
          {tokens.map((t) => (
            <span
              key={t.id}
              className={`grid size-[clamp(14px,1.6vw,22px)] place-items-center rounded-full border text-[clamp(6px,0.65vw,9px)] font-semibold text-ink ${
                t.mine ? "border-parchment" : "border-ink"
              } ${t.jailed ? "opacity-70 outline-2 outline-blood" : ""}`}
              style={{ background: t.color }}
            >
              {t.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Dice({ roll }: { roll: readonly [number, number] | null }) {
  if (!roll) return <p className="text-sm text-parchment-dim">No dice rolled yet</p>;
  return (
    <div className="flex gap-2" role="img" aria-label={`Last roll ${roll[0]} and ${roll[1]}`}>
      {roll.map((value, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: two dice in fixed positions
          key={i}
          className="grid size-10 grid-cols-3 grid-rows-3 gap-0.5 rounded-md bg-parchment p-1.5 sm:size-12"
        >
          {Array.from({ length: 9 }, (_, cell) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed pip grid
              key={cell}
              className={`rounded-full ${PIPS[value]?.includes(cell) ? "bg-ink" : ""}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
