import {
  type ColorGroup,
  DECKS,
  type DeckId,
  getBoard,
  isOwnable,
  type PublicGameState,
  type Space,
  WALKER,
} from "@richual/engine";
import type { LobbyPlayer } from "@richual/protocol";
import { useEffect, useState } from "react";
import { GROUP_COLORS, initials, SOULS, seatColor } from "../theme";
import { heroLabel } from "./heroLabel";
import { SpaceIcon } from "./SpaceIcon";
import { useAnimatedPositions } from "./useAnimatedPositions";

/** Corner cells are wider; these are the grid track widths in board units. */
const TRACKS = [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5];
const TRACK_TOTAL = TRACKS.reduce((a, b) => a + b, 0);

/** Grid cell (1-based) for a space index on an 11×11 board, starting at the bottom-right corner. */
function cellFor(index: number): { row: number; col: number } {
  if (index <= 10) return { row: 11, col: 11 - index };
  if (index <= 20) return { row: 21 - index, col: 1 };
  if (index <= 30) return { row: 1, col: index - 19 };
  return { row: index - 29, col: 11 };
}

/** Centre of a grid track as a percentage of the board. */
function trackCenter(track: number): number {
  const before = TRACKS.slice(0, track - 1).reduce((a, b) => a + b, 0);
  return ((before + (TRACKS[track - 1] ?? 1) / 2) / TRACK_TOTAL) * 100;
}

/** Texture overlaid on each group's colour band, so groups differ by more than colour. */
const GROUP_PATTERNS: Record<ColorGroup, string> = {
  brown: "none",
  lightBlue: "repeating-linear-gradient(45deg, rgb(0 0 0 / 0.25) 0 2px, transparent 2px 6px)",
  pink: "radial-gradient(rgb(0 0 0 / 0.3) 1px, transparent 1.5px) 0 0 / 5px 5px",
  orange: "repeating-linear-gradient(90deg, rgb(0 0 0 / 0.25) 0 2px, transparent 2px 6px)",
  red: "repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.25) 0 2px, transparent 2px 6px)",
  yellow:
    "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.2) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgb(0 0 0 / 0.2) 0 1px, transparent 1px 4px)",
  green: "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.25) 0 2px, transparent 2px 6px)",
  darkBlue: "radial-gradient(rgb(255 255 255 / 0.25) 1px, transparent 1.5px) 0 0 / 6px 6px",
};

/** Small offsets so several tokens on one space stay visible. */
const TOKEN_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  [0, -1],
  [0, 1],
];

export type ShownCard = { seq: number; deck: DeckId; cardId: string };

type Props = {
  game: PublicGameState;
  players: LobbyPlayer[];
  myId: string | null;
  selected: number | null;
  onSelect: (space: number) => void;
  lastCard: ShownCard | null;
};

export function Board({ game, players, myId, selected, onSelect, lastCard }: Props) {
  const board = getBoard(game.config.boardId);
  const lobbyPlayer = (id: string) => players.find((p) => p.id === id);
  const seatOf = (id: string) => lobbyPlayer(id)?.seat ?? 0;
  const current = game.players[game.turn.playerIndex];
  const active = game.players.filter((p) => !p.bankrupt);
  const positions = useAnimatedPositions(
    Object.fromEntries(active.map((p) => [p.id, p.position])),
    board.spaces.length,
  );

  return (
    <div className="relative aspect-square w-full rounded-sm p-1.5 deco-frame">
      <div
        className="grid size-full gap-px bg-brass-dim/40"
        style={{
          gridTemplateColumns: TRACKS.map((t) => `${t}fr`).join(" "),
          gridTemplateRows: TRACKS.map((t) => `${t}fr`).join(" "),
        }}
      >
        {board.spaces.map((space, index) => {
          const { row, col } = cellFor(index);
          const owner = game.owners[index];
          const here = active.filter((p) => p.position === index);
          return (
            <SpaceCell
              // biome-ignore lint/suspicious/noArrayIndexKey: board spaces are fixed and identified by index
              key={index}
              space={space}
              row={row}
              col={col}
              owner={
                owner
                  ? {
                      name: lobbyPlayer(owner)?.name ?? "",
                      color: seatColor(seatOf(owner)),
                      label: initials(heroLabel(lobbyPlayer(owner)?.hero ?? null, "")),
                    }
                  : null
              }
              buildings={game.buildings[index] ?? 0}
              sealed={game.sealed[index] ?? false}
              selected={selected === index}
              occupants={here.map((p) => p.name)}
              onSelect={() => onSelect(index)}
            />
          );
        })}

        <div
          className="relative flex flex-col items-center justify-center gap-2 overflow-hidden bg-smoke p-2 text-center sm:gap-3 sm:p-4"
          style={{ gridRow: "2 / 11", gridColumn: "2 / 11" }}
        >
          <Sunburst />
          <p className="relative font-display text-2xl tracking-wide text-brass sm:text-5xl">
            Richual
          </p>
          <CardOrDice lastCard={lastCard} roll={game.turn.lastRoll} />
          {current && (
            <p className="relative text-xs text-parchment-dim sm:text-sm">
              Round {game.turn.round}: <span className="text-parchment">{current.name}</span>
            </p>
          )}
          {game.config.freeParkingJackpot && (
            <p className="relative text-xs text-parchment-dim sm:text-sm">
              Soul Urn:{" "}
              <span className="tabular-nums text-amber">
                {game.urn} {SOULS}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Tokens sit in their own layer so they can glide between spaces. */}
      <div className="pointer-events-none absolute inset-1.5" aria-hidden>
        {active.map((p) => {
          const position = positions[p.id] ?? p.position;
          const { row, col } = cellFor(position);
          const stacked = active.filter((o) => (positions[o.id] ?? o.position) === position);
          const [dx, dy] =
            stacked.length > 1 ? (TOKEN_OFFSETS[stacked.indexOf(p)] ?? [0, 0]) : [0, 0];
          const info = lobbyPlayer(p.id);
          return (
            <span
              key={p.id}
              className={`absolute grid size-[clamp(12px,3.2%,24px)] place-items-center rounded-full border text-[clamp(5px,1.1%,9px)] font-semibold text-ink shadow-md shadow-black/60 transition-[left,top] duration-75 ease-linear ${
                p.id === myId ? "border-parchment" : "border-ink"
              } ${p.inJail ? "outline-2 outline-blood" : ""} ${
                p.id === current?.id ? "ring-2 ring-amber/70" : ""
              }`}
              style={{
                left: `calc(${trackCenter(col)}% + ${dx * 32}% / 11)`,
                top: `calc(${trackCenter(row)}% + ${dy * 32}% / 11)`,
                transform: "translate(-50%, -50%)",
                background: seatColor(info?.seat ?? 0),
              }}
            >
              {initials(heroLabel(info?.hero ?? null, p.name))}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SpaceCell({
  space,
  row,
  col,
  owner,
  buildings,
  sealed,
  selected,
  occupants,
  onSelect,
}: {
  space: Space;
  row: number;
  col: number;
  owner: { name: string; color: string; label: string } | null;
  buildings: number;
  sealed: boolean;
  selected: boolean;
  occupants: string[];
  onSelect: () => void;
}) {
  const description = [
    space.name,
    "price" in space ? `price ${space.price} ${SOULS}` : null,
    owner ? `owned by ${owner.name}` : null,
    buildings === WALKER ? "a Walker" : buildings > 0 ? `${buildings} Guardians` : null,
    sealed ? "sealed" : null,
    occupants.length ? `here: ${occupants.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const corner = (row === 1 || row === 11) && (col === 1 || col === 11);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-smoke-light text-left text-[clamp(5px,0.75vw,11px)] leading-tight transition-colors hover:bg-[#332d25] ${
        selected ? "z-10 outline-2 outline-amber" : ""
      }`}
      style={{ gridRow: row, gridColumn: col }}
      title={description}
      aria-label={description}
    >
      {space.kind === "property" && (
        <div
          className="h-[18%] shrink-0"
          style={{
            backgroundColor: GROUP_COLORS[space.group],
            background: `${GROUP_PATTERNS[space.group]}, ${GROUP_COLORS[space.group]}`,
          }}
        />
      )}
      <div
        className={`flex flex-1 flex-col items-center justify-between p-0.5 text-center ${
          sealed ? "opacity-50" : ""
        }`}
      >
        <span
          className={`line-clamp-3 ${corner ? "font-display text-brass sm:text-[1.15em]" : "text-parchment"} max-sm:hidden`}
        >
          {space.name}
        </span>
        <SpaceIcon
          space={space}
          className={`${corner ? "size-[45%]" : "size-[38%]"} shrink-0 text-brass/80`}
        />
        {buildings > 0 && (
          <span className="text-amber" aria-hidden>
            {buildings === WALKER ? "◆ Walker" : "▲".repeat(buildings)}
          </span>
        )}
        {isOwnable(space) && !owner && (
          <span className="tabular-nums text-parchment-dim max-sm:hidden">
            {space.price}
            {SOULS}
          </span>
        )}
      </div>
      {sealed && (
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-sm border border-blood px-0.5 text-[0.85em] font-semibold uppercase tracking-wider text-blood"
          aria-hidden
        >
          Sealed
        </span>
      )}
      {owner && (
        <span
          className="h-[14%] min-h-1 shrink-0 text-center text-[0.8em] leading-none font-semibold text-ink"
          style={{ background: owner.color }}
          aria-hidden
        >
          <span className="max-sm:hidden">{owner.label}</span>
        </span>
      )}
    </button>
  );
}

/** The last drawn card, shown in the centre for a few seconds; otherwise the dice. */
function CardOrDice({
  lastCard,
  roll,
}: {
  lastCard: ShownCard | null;
  roll: readonly [number, number] | null;
}) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [expired, setExpired] = useState<number | null>(null);
  const seq = lastCard?.seq ?? null;

  useEffect(() => {
    if (seq === null) return;
    const timer = setTimeout(() => setExpired(seq), 6000);
    return () => clearTimeout(timer);
  }, [seq]);

  const card = lastCard && DECKS[lastCard.deck].cards.find((c) => c.id === lastCard.cardId);
  if (lastCard && card && dismissed !== lastCard.seq && expired !== lastCard.seq) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(lastCard.seq)}
        className="relative w-[min(16rem,80%)] rounded-sm border-2 border-brass bg-parchment p-2 text-left text-ink shadow-xl shadow-black/60 card-reveal sm:p-3"
        aria-label={`${DECKS[lastCard.deck].name} card: ${card.text}. Click to dismiss.`}
      >
        <span className="block border-b border-ink/30 pb-1 font-display text-xs tracking-widest uppercase sm:text-sm">
          {DECKS[lastCard.deck].name}
        </span>
        <span className="mt-1 block text-[10px] leading-snug sm:text-sm">{card.text}</span>
      </button>
    );
  }
  return <Dice roll={roll} />;
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
  if (!roll) return <p className="relative text-sm text-parchment-dim">No dice rolled yet</p>;
  return (
    <div
      key={roll.join("-")}
      className="relative flex gap-2 dice-roll"
      role="img"
      aria-label={`Last roll ${roll[0]} and ${roll[1]}`}
    >
      {roll.map((value, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: two dice in fixed positions
          key={i}
          className="grid size-8 grid-cols-3 grid-rows-3 gap-0.5 rounded-md bg-parchment p-1 shadow-md shadow-black/50 sm:size-12 sm:p-1.5"
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

/** Art deco rays behind the board's title. */
function Sunburst() {
  return (
    <svg
      viewBox="-100 -100 200 200"
      className="pointer-events-none absolute inset-0 size-full text-brass opacity-[0.07]"
      aria-hidden
    >
      {Array.from({ length: 24 }, (_, i) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative rays
          key={i}
          d="M0 0 L-6 -140 L6 -140 Z"
          fill="currentColor"
          transform={`rotate(${i * 15})`}
        />
      ))}
      <circle r="38" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle r="44" fill="none" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
}
