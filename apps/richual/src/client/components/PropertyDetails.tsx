import {
  type Action,
  getBoard,
  getLegalActions,
  groupIndices,
  indicesOfKind,
  isOwnable,
  mortgageValue,
  type PublicGameState,
  unsealCost,
  WALKER,
} from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import { X } from "lucide-react";
import { sendAction, useConnection } from "../connection";
import { GROUP_COLORS, SOULS, seatColor } from "../theme";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SpaceIcon } from "./SpaceIcon";

const SPACE_NOTES: Record<string, string> = {
  go: "Collect your salary each time you pass.",
  tax: "Pay the amount shown when you land here.",
  card: "Draw a card when you land here.",
  jail: "Banished players wait here. Others are just visiting.",
  freeParking: "Collects taxes and fines when the Soul Urn rule is on.",
  goToJail: "Land here and you are banished to the Lost Whisper.",
};

/** Everything about one board space, plus the build/sell/seal actions you can take on it. */
export function PropertyDetails({
  lobby,
  game,
  space: index,
  onClose,
}: {
  lobby: LobbySnapshot;
  game: PublicGameState;
  space: number;
  onClose: () => void;
}) {
  const { playerId, pendingActionId } = useConnection();
  const board = getBoard(game.config.boardId);
  const space = board.spaces[index];
  if (!space) return null;
  const owner = game.owners[index];
  const ownerName = owner ? lobby.players.find((p) => p.id === owner)?.name : null;
  const buildings = game.buildings[index] ?? 0;
  const sealed = game.sealed[index] ?? false;
  const actions = (playerId ? getLegalActions(game, playerId) : []).filter(
    (a): a is Extract<Action, { space: number }> => "space" in a && a.space === index,
  );

  const actionLabel = (action: Extract<Action, { space: number }>) => {
    switch (action.type) {
      case "build":
        if (space.kind !== "property") return "Build";
        return `${buildings === game.config.guardiansPerWalker ? "Raise a Walker" : "Build a Guardian"} · −${space.buildCost} ${SOULS}`;
      case "sellBuilding":
        return space.kind === "property"
          ? `Sell a building · +${space.buildCost / 2} ${SOULS}`
          : "Sell";
      case "seal":
        return `Seal · +${mortgageValue(board, index)} ${SOULS}`;
      case "unseal":
        return `Unseal · −${unsealCost(board, index)} ${SOULS}`;
    }
  };

  const kindLabel =
    space.kind === "property"
      ? board.groups[space.group].organization
      : space.kind === "zipline"
        ? "Zipline"
        : space.kind === "utility"
          ? "Utility"
          : (SPACE_NOTES[space.kind] ?? "");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {space.kind === "property" ? (
          <span
            className="mt-1 h-8 w-1.5 shrink-0 rounded-full"
            style={{ background: GROUP_COLORS[space.group] }}
            aria-hidden
          />
        ) : (
          <SpaceIcon space={space} className="mt-0.5 size-6 shrink-0 text-accent-text" />
        )}
        <div className="min-w-0 flex-1">
          <h2 id="property-heading" className="font-semibold leading-tight">
            {space.name}
          </h2>
          <p className="text-xs text-muted">{kindLabel}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-1 size-8"
          aria-label="Close"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      {space.kind === "tax" && (
        <p className="text-sm">
          Pay {space.amount} {SOULS}.
        </p>
      )}

      {isOwnable(space) && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {ownerName ? (
              <Badge variant="accent">Owned by {ownerName}</Badge>
            ) : (
              <Badge>
                Unowned · {space.price} {SOULS}
              </Badge>
            )}
            {buildings > 0 && (
              <Badge>
                {buildings === WALKER
                  ? "Walker"
                  : `${buildings} Guardian${buildings > 1 ? "s" : ""}`}
              </Badge>
            )}
            {sealed && <Badge variant="danger">Sealed · no rent</Badge>}
          </div>

          <SetProgress lobby={lobby} game={game} space={index} />

          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
            {space.kind === "property" && (
              <>
                <Row label="Rent" value={space.rent[0]} />
                <Row label="With the full set" value={space.rent[0] * 2} />
                {Array.from({ length: game.config.guardiansPerWalker }, (_, i) => i + 1).map(
                  (n) => (
                    <Row key={n} label={`${n} Guardian${n > 1 ? "s" : ""}`} value={space.rent[n]} />
                  ),
                )}
                <Row label="Walker" value={space.rent[WALKER]} />
                <Row label="Each building" value={space.buildCost} muted />
              </>
            )}
            {space.kind === "zipline" &&
              board.ziplineRent.map((rent, i) => (
                <Row key={rent} label={`Owning ${i + 1}`} value={rent} />
              ))}
            {space.kind === "utility" && (
              <>
                <Row label="Owning 1" value={`${board.utilityMultiplier[0]}× dice`} />
                <Row label="Owning both" value={`${board.utilityMultiplier[1]}× dice`} />
              </>
            )}
            <Row label="Seal value" value={mortgageValue(board, index)} muted />
          </dl>
        </>
      )}

      {actions.length > 0 && (
        <div className="flex flex-col gap-2">
          {actions.map((action) => (
            <Button
              key={action.type}
              variant={action.type === "build" ? "primary" : "outline"}
              disabled={pendingActionId !== null}
              onClick={() => sendAction(action)}
            >
              {actionLabel(action)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: number | string | undefined;
  muted?: boolean;
}) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right tabular-nums ${muted ? "text-muted" : ""}`}>{value}</dd>
    </>
  );
}

/** Who holds the rest of this space's set: the colour group, or all ziplines or utilities. */
function SetProgress({
  lobby,
  game,
  space: index,
}: {
  lobby: LobbySnapshot;
  game: PublicGameState;
  space: number;
}) {
  const { playerId } = useConnection();
  const board = getBoard(game.config.boardId);
  const space = board.spaces[index];
  if (!space || !isOwnable(space)) return null;
  const members =
    space.kind === "property" ? groupIndices(board, space.group) : indicesOfKind(board, space.kind);
  const setName =
    space.kind === "property"
      ? board.groups[space.group].organization
      : space.kind === "zipline"
        ? "ziplines"
        : "utilities";

  const counts = new Map<string | null, number>();
  for (const i of members) {
    const owner = game.owners[i] ?? null;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  const holders = [...counts.entries()]
    .filter((entry): entry is [string, number] => entry[0] !== null)
    .sort((a, b) => b[1] - a[1]);
  const unowned = counts.get(null) ?? 0;

  return (
    <div className="text-sm">
      <p className="mb-1.5 text-xs text-muted">
        {setName} · {members.length} in the set
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {holders.map(([owner, count]) => {
          const info = lobby.players.find((p) => p.id === owner);
          return (
            <li
              key={owner}
              className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-2 pl-1"
            >
              <span
                className="size-3 rounded-full ring-1 ring-black/25"
                style={{ background: seatColor(info?.seat ?? 0) }}
                aria-hidden
              />
              {owner === playerId ? "You" : (info?.name ?? "Someone")} own
              {owner === playerId ? "" : "s"} {count}
              {count === members.length && " (full set)"}
            </li>
          );
        })}
        {unowned > 0 && (
          <li className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">{unowned} unowned</li>
        )}
      </ul>
    </div>
  );
}
