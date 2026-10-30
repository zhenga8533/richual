import {
  type ColorGroup,
  DECKS,
  type DeckId,
  getBoard,
  groupIndices,
  isOwnable,
  type PublicGameState,
  type Space,
  WALKER,
} from "@richual/engine";
import type { LobbyPlayer } from "@richual/protocol";
import { type RefObject, useEffect, useRef, useState } from "react";
import { shortName } from "../boardLabels";
import { GROUP_COLORS, initials, SOULS, seatColor } from "../theme";
import { cn } from "../ui/cn";
import { heroLabel } from "./heroLabel";
import { SpaceIcon } from "./SpaceIcon";
import { useAnimatedPositions } from "./useAnimatedPositions";

/** Corner cells are wider; these are the grid track widths in board units. */
const TRACKS = [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5];
const TRACK_TOTAL = TRACKS.reduce((a, b) => a + b, 0);

type Side = "bottom" | "left" | "top" | "right" | "corner";

/** Grid cell (1-based) for a space index on an 11×11 board, starting at the bottom-right corner. */
function cellFor(index: number): { row: number; col: number } {
  if (index <= 10) return { row: 11, col: 11 - index };
  if (index <= 20) return { row: 21 - index, col: 1 };
  if (index <= 30) return { row: 1, col: index - 19 };
  return { row: index - 29, col: 11 };
}

function sideOf(index: number): Side {
  if (index % 10 === 0) return "corner";
  if (index < 10) return "bottom";
  if (index < 20) return "left";
  if (index < 30) return "top";
  return "right";
}

/** Centre of a grid track as a percentage of the board. */
function trackCenter(track: number): number {
  const before = TRACKS.slice(0, track - 1).reduce((a, b) => a + b, 0);
  return ((before + (TRACKS[track - 1] ?? 1) / 2) / TRACK_TOTAL) * 100;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Texture overlaid on each group's colour band, so groups differ by more than colour. */
const GROUP_PATTERNS: Record<ColorGroup, string> = {
  brown: "none",
  lightBlue: "repeating-linear-gradient(45deg, rgb(0 0 0 / 0.22) 0 2px, transparent 2px 6px)",
  pink: "radial-gradient(rgb(0 0 0 / 0.28) 1px, transparent 1.5px) 0 0 / 5px 5px",
  orange: "repeating-linear-gradient(90deg, rgb(0 0 0 / 0.22) 0 2px, transparent 2px 6px)",
  red: "repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.22) 0 2px, transparent 2px 6px)",
  yellow:
    "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.18) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgb(0 0 0 / 0.18) 0 1px, transparent 1px 4px)",
  green: "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.22) 0 2px, transparent 2px 6px)",
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

type Owner = { id: string; name: string; color: string; label: string };

type Props = {
  game: PublicGameState;
  players: LobbyPlayer[];
  myId: string | null;
  selected: number | null;
  /** Receives the selected cell, so a popover can anchor to it. */
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (space: number) => void;
  lastCard: ShownCard | null;
  /** Dims everything this player does not own. */
  highlightOwner: string | null;
};

export function Board({
  game,
  players,
  myId,
  selected,
  anchorRef,
  onSelect,
  lastCard,
  highlightOwner,
}: Props) {
  const board = getBoard(game.config.boardId);
  const lobbyPlayer = (id: string) => players.find((p) => p.id === id);
  const current = game.players[game.turn.playerIndex];
  const active = game.players.filter((p) => !p.bankrupt);
  const ownerOf = (index: number): Owner | null => {
    const id = game.owners[index];
    if (!id) return null;
    const info = lobbyPlayer(id);
    return {
      id,
      name: info?.name ?? "",
      color: seatColor(info?.seat ?? 0),
      label: initials(heroLabel(info?.hero ?? null, info?.name ?? "")),
    };
  };
  const flashes = usePurchaseFlashes(game.owners);

  return (
    <div className="board-frame relative aspect-square w-full rounded-2xl bg-board p-1">
      <div
        className="grid size-full gap-px overflow-hidden rounded-xl bg-line-strong"
        style={{
          gridTemplateColumns: TRACKS.map((t) => `${t}fr`).join(" "),
          gridTemplateRows: TRACKS.map((t) => `${t}fr`).join(" "),
        }}
      >
        {board.spaces.map((space, index) => {
          const owner = ownerOf(index);
          return (
            <SpaceCell
              // biome-ignore lint/suspicious/noArrayIndexKey: board spaces are fixed and identified by index
              key={index}
              space={space}
              index={index}
              owner={owner}
              buildings={game.buildings[index] ?? 0}
              sealed={game.sealed[index] ?? false}
              selected={selected === index}
              dimmed={highlightOwner !== null && owner?.id !== highlightOwner}
              flash={flashes[index] ?? null}
              occupants={active.filter((p) => p.position === index).map((p) => p.name)}
              cellRef={
                selected === index
                  ? (el) => {
                      anchorRef.current = el;
                    }
                  : undefined
              }
              onSelect={() => onSelect(index)}
            />
          );
        })}

        <div
          className="relative flex flex-col items-center justify-center gap-2 overflow-hidden bg-board p-2 text-center sm:gap-3 sm:p-4"
          style={{ gridRow: "2 / 11", gridColumn: "2 / 11" }}
        >
          <Sunburst />
          <OwnershipBars game={game} ownerOf={ownerOf} highlightOwner={highlightOwner} />
          <p className="relative font-display text-2xl text-accent-text sm:text-5xl">Richual</p>
          <CardOrDice lastCard={lastCard} roll={game.turn.lastRoll} />
          {current && (
            <p className="relative text-xs text-muted sm:text-sm">
              Round {game.turn.round} · <span className="text-fg">{current.name}</span>
            </p>
          )}
          {game.config.freeParkingJackpot && (
            <p className="relative rounded-full bg-surface/70 px-3 py-1 text-xs text-muted backdrop-blur-sm sm:text-sm">
              Soul Urn{" "}
              <span className="font-semibold tabular-nums text-accent-text">
                {game.urn} {SOULS}
              </span>
            </p>
          )}
        </div>
      </div>

      <TokenLayer game={game} players={players} myId={myId} />
    </div>
  );
}

// ---------- Cells ----------

function SpaceCell({
  space,
  index,
  owner,
  buildings,
  sealed,
  selected,
  dimmed,
  flash,
  occupants,
  cellRef,
  onSelect,
}: {
  space: Space;
  index: number;
  owner: Owner | null;
  buildings: number;
  sealed: boolean;
  selected: boolean;
  dimmed: boolean;
  /** Changes whenever the space is newly bought, replaying the purchase flash. */
  flash: number | null;
  occupants: string[];
  cellRef?: (el: HTMLButtonElement | null) => void;
  onSelect: () => void;
}) {
  const { row, col } = cellFor(index);
  const side = sideOf(index);
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
  // The colour band always faces the centre of the board.
  const layout = {
    bottom: "flex-col",
    top: "flex-col-reverse",
    left: "flex-row-reverse",
    right: "flex-row",
    corner: "flex-col",
  }[side];
  const horizontal = side === "left" || side === "right";

  return (
    <button
      ref={cellRef}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-haspopup="dialog"
      className={cn(
        "@container relative flex min-h-0 min-w-0 overflow-hidden bg-cell text-[clamp(6px,15cqmin,13px)] leading-tight text-fg transition-[background-color,opacity] [container-type:size] hover:bg-cell-hover",
        layout,
        selected && "z-10 ring-2 ring-accent ring-inset",
        dimmed && "opacity-30",
        flash && "buy-flash",
      )}
      style={{
        gridRow: row,
        gridColumn: col,
        ...(owner && {
          backgroundColor: `color-mix(in oklab, ${owner.color} 13%, var(--cell))`,
        }),
        ...(owner && { "--flash": owner.color }),
      }}
      key={flash ?? undefined}
      title={description}
      aria-label={description}
    >
      {space.kind === "property" && (
        <span
          className={cn("block shrink-0", horizontal ? "h-full w-[16%]" : "h-[16%] w-full")}
          style={{
            backgroundColor: GROUP_COLORS[space.group],
            background: `${GROUP_PATTERNS[space.group]}, ${GROUP_COLORS[space.group]}`,
          }}
        />
      )}
      <span
        className={cn(
          "flex min-h-0 min-w-0 flex-1 items-center justify-center gap-[7%] p-[6%] text-center",
          horizontal ? "flex-row" : "flex-col",
          side === "left" && "flex-row-reverse",
          sealed && "opacity-40",
        )}
      >
        {space.kind !== "property" && (
          <SpaceIcon
            space={space}
            className={cn(
              "shrink-0 text-accent-text/80",
              side === "corner" ? "size-[30cqmin]" : "size-[34cqmin]",
            )}
          />
        )}
        <span className="flex min-w-0 flex-col items-center gap-[0.25em]">
          <span
            className={cn(
              "space-name line-clamp-3 font-medium [overflow-wrap:anywhere] [hyphens:auto] @max-[46px]:hidden",
              side === "corner" && "font-display font-normal text-accent-text",
            )}
          >
            <span className="@max-[88px]:hidden">{space.name}</span>
            <span className="@min-[88px]:hidden">{shortName(space.name)}</span>
          </span>
          {buildings > 0 && (
            <span className="font-semibold text-accent-text" aria-hidden>
              {buildings === WALKER ? "◆" : "▲".repeat(buildings)}
            </span>
          )}
          {isOwnable(space) && !owner && (
            <span className="rounded-full bg-surface-2 px-[0.5em] tabular-nums text-muted">
              {space.price}
            </span>
          )}
          {owner && (
            <span
              className="rounded-full px-[0.45em] text-[0.85em] font-bold text-ink"
              style={{ background: owner.color }}
              aria-hidden
            >
              {owner.label}
            </span>
          )}
        </span>
      </span>
      {sealed && (
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-sm border border-danger bg-cell/80 px-[0.3em] text-[0.85em] font-semibold tracking-wider text-danger uppercase"
          aria-hidden
        >
          Sealed
        </span>
      )}
    </button>
  );
}

/** Marks cells whose owner just changed, so they flash in the new owner's colour. */
function usePurchaseFlashes(owners: (string | null)[]): Record<number, number> {
  const previous = useRef(owners);
  const [flashes, setFlashes] = useState<Record<number, number>>({});
  const key = owners.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures every ownership change
  useEffect(() => {
    const before = previous.current;
    previous.current = owners;
    const changed = owners.flatMap((o, i) => (o && o !== before[i] ? [i] : []));
    if (changed.length === 0 || reducedMotion()) return;
    const stamp = Date.now();
    setFlashes((f) => {
      const next = { ...f };
      for (const i of changed) next[i] = stamp;
      return next;
    });
    const timer = setTimeout(
      () =>
        setFlashes((f) => {
          const next = { ...f };
          for (const i of changed) if (next[i] === stamp) delete next[i];
          return next;
        }),
      900,
    );
    return () => clearTimeout(timer);
  }, [key]);

  return flashes;
}

// ---------- Ownership along the inside of the board ----------

/**
 * A bar along the inner edge of the board for every owned space, in its owner's
 * colour; complete colour sets get a thicker, glowing bar.
 */
function OwnershipBars({
  game,
  ownerOf,
  highlightOwner,
}: {
  game: PublicGameState;
  ownerOf: (index: number) => Owner | null;
  highlightOwner: string | null;
}) {
  const board = getBoard(game.config.boardId);
  const fullSet = (index: number) => {
    const space = board.spaces[index];
    if (space?.kind !== "property") return false;
    const owner = game.owners[index];
    return groupIndices(board, space.group).every((i) => game.owners[i] === owner);
  };

  return (
    <div className="pointer-events-none absolute inset-[3px]" aria-hidden>
      {board.spaces.map((_, index) => {
        const owner = ownerOf(index);
        const side = sideOf(index);
        if (!owner || side === "corner") return null;
        const { row, col } = cellFor(index);
        // Position along the inner edge, as a fraction of the nine middle tracks.
        const along = side === "bottom" || side === "top" ? col - 2 : row - 2;
        const complete = fullSet(index);
        const thickness = complete ? "6px" : "3.5px";
        const style: React.CSSProperties = {
          background: owner.color,
          boxShadow: complete ? `0 0 8px ${owner.color}` : undefined,
          opacity: highlightOwner && highlightOwner !== owner.id ? 0.15 : 1,
        };
        const span = `calc(${100 / 9}% - 4px)`;
        const offset = `calc(${(along * 100) / 9}% + 2px)`;
        if (side === "bottom" || side === "top") {
          Object.assign(style, { left: offset, width: span, height: thickness });
          style[side] = 0;
        } else {
          Object.assign(style, { top: offset, height: span, width: thickness });
          style[side] = 0;
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: board spaces are fixed and identified by index
          <span key={index} className="absolute rounded-full transition-opacity" style={style} />
        );
      })}
    </div>
  );
}

// ---------- Tokens and soul floaters ----------

type Floater = { id: number; playerId: string; delta: number };

function TokenLayer({
  game,
  players,
  myId,
}: {
  game: PublicGameState;
  players: LobbyPlayer[];
  myId: string | null;
}) {
  const board = getBoard(game.config.boardId);
  const current = game.players[game.turn.playerIndex];
  const active = game.players.filter((p) => !p.bankrupt);
  const positions = useAnimatedPositions(
    Object.fromEntries(active.map((p) => [p.id, p.position])),
    board.spaces.length,
  );
  const floaters = useSoulFloaters(game);
  const lobbyPlayer = (id: string) => players.find((p) => p.id === id);
  const at = (id: string) => {
    const position = positions[id] ?? active.find((p) => p.id === id)?.position ?? 0;
    const { row, col } = cellFor(position);
    const stacked = active.filter((o) => (positions[o.id] ?? o.position) === position);
    const [dx, dy] =
      stacked.length > 1
        ? (TOKEN_OFFSETS[stacked.findIndex((o) => o.id === id)] ?? [0, 0])
        : [0, 0];
    return {
      left: `calc(${trackCenter(col)}% + ${dx * 32}% / 11)`,
      top: `calc(${trackCenter(row)}% + ${dy * 32}% / 11)`,
    };
  };

  return (
    <div className="pointer-events-none absolute inset-1" aria-hidden>
      {active.map((p) => {
        const info = lobbyPlayer(p.id);
        return (
          <span
            key={p.id}
            className={cn(
              "absolute grid size-[clamp(14px,3.4%,26px)] place-items-center rounded-full text-[clamp(5px,1.1%,9px)] font-bold text-ink shadow-md ring-2 ring-black/50 transition-[left,top] duration-75 ease-linear",
              p.id === myId && "ring-fg",
              p.inJail && "outline-2 outline-offset-1 outline-danger",
              p.id === current?.id && game.phase.kind !== "gameOver" && "scale-110",
            )}
            style={{
              ...at(p.id),
              transform: "translate(-50%, -50%)",
              background: seatColor(info?.seat ?? 0),
            }}
          >
            {initials(heroLabel(info?.hero ?? null, p.name))}
          </span>
        );
      })}
      {floaters.map((f) =>
        active.some((p) => p.id === f.playerId) ? (
          <span
            key={f.id}
            className={cn(
              "soul-float absolute rounded-full px-1.5 py-0.5 text-[clamp(9px,1.6%,13px)] font-bold whitespace-nowrap shadow-md tabular-nums",
              f.delta > 0 ? "bg-emerald-600 text-white" : "bg-danger text-danger-fg",
            )}
            style={at(f.playerId)}
          >
            {f.delta > 0 ? "+" : "−"}
            {Math.abs(f.delta)} {SOULS}
          </span>
        ) : null,
      )}
    </div>
  );
}

/** Short-lived "+200 ◈" / "−50 ◈" labels whenever a player's souls change. */
function useSoulFloaters(game: PublicGameState): Floater[] {
  const previous = useRef<Record<string, number> | null>(null);
  const nextId = useRef(0);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const key = game.players.map((p) => `${p.id}:${p.cash}`).join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures every cash change
  useEffect(() => {
    const cash = Object.fromEntries(game.players.map((p) => [p.id, p.cash]));
    const before = previous.current;
    previous.current = cash;
    if (!before || reducedMotion()) return;
    const added = game.players.flatMap((p) => {
      const delta = p.cash - (before[p.id] ?? p.cash);
      return delta === 0 ? [] : [{ id: nextId.current++, playerId: p.id, delta }];
    });
    if (added.length === 0) return;
    setFloaters((f) => [...f, ...added]);
    const timer = setTimeout(
      () => setFloaters((f) => f.filter((x) => !added.some((a) => a.id === x.id))),
      1300,
    );
    return () => clearTimeout(timer);
  }, [key]);

  return floaters;
}

// ---------- Centre ----------

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
        className="card-reveal relative w-[min(16rem,80%)] rounded-xl border border-accent/60 bg-surface p-3 text-left text-fg shadow-pop sm:p-4"
        aria-label={`${DECKS[lastCard.deck].name} card: ${card.text}. Click to dismiss.`}
      >
        <span className="block text-[10px] font-semibold tracking-widest text-accent-text uppercase sm:text-xs">
          {DECKS[lastCard.deck].name}
        </span>
        <span className="mt-1.5 block text-[11px] leading-snug sm:text-sm">{card.text}</span>
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

/** Shows random faces for a moment after each new roll, then settles on the real one. */
function useTumble(roll: readonly [number, number] | null): readonly [number, number] | null {
  const [shown, setShown] = useState(roll);
  const first = useRef(true);
  const key = roll?.join("-") ?? "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures every new roll
  useEffect(() => {
    // The roll already on screen when the game loads is not animated.
    if (first.current || !roll || reducedMotion()) {
      first.current = false;
      setShown(roll);
      return;
    }
    const face = () => 1 + Math.floor(Math.random() * 6);
    const tick = setInterval(() => setShown([face(), face()]), 60);
    const stop = setTimeout(() => {
      clearInterval(tick);
      setShown(roll);
    }, 380);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [key]);

  return shown;
}

function Dice({ roll }: { roll: readonly [number, number] | null }) {
  const shown = useTumble(roll);
  if (!roll || !shown) return <p className="relative text-sm text-muted">No dice rolled yet</p>;
  return (
    <div
      key={roll.join("-")}
      className="dice-roll relative flex gap-2"
      role="img"
      aria-label={`Last roll ${roll[0]} and ${roll[1]}`}
    >
      {shown.map((value, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: two dice in fixed positions
          key={i}
          className="grid size-8 grid-cols-3 grid-rows-3 gap-0.5 rounded-lg bg-[#f6efdc] p-1 shadow-md ring-1 ring-black/10 sm:size-12 sm:p-1.5"
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
      className="pointer-events-none absolute inset-0 size-full text-accent opacity-[0.06]"
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
