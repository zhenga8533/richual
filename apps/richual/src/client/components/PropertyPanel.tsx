import {
  type Action,
  getBoard,
  getLegalActions,
  isOwnable,
  mortgageValue,
  type PublicGameState,
  unsealCost,
  WALKER,
} from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import { sendAction, useConnection } from "../connection";
import { GROUP_COLORS, SOULS } from "../theme";

type Props = {
  lobby: LobbySnapshot;
  game: PublicGameState;
  space: number;
  onClose: () => void;
};

const SPACE_NOTES: Record<string, string> = {
  go: "Collect your salary each time you pass.",
  tax: "Pay the amount shown when you land here.",
  card: "Draw a card when you land here.",
  jail: "Banished players wait here. Others are just visiting.",
  freeParking: "Collects taxes and fines when the Soul Urn rule is on.",
  goToJail: "Land here and you are banished to the Lost Whisper.",
};

export function PropertyPanel({ lobby, game, space: index, onClose }: Props) {
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
        return `${buildings === WALKER - 1 ? "Raise a Walker" : "Build a Guardian"} (−${space.buildCost} ${SOULS})`;
      case "sellBuilding":
        return space.kind === "property"
          ? `Sell a building (+${space.buildCost / 2} ${SOULS})`
          : "Sell";
      case "seal":
        return `Seal (+${mortgageValue(board, index)} ${SOULS})`;
      case "unseal":
        return `Unseal (−${unsealCost(board, index)} ${SOULS})`;
    }
  };

  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="property-heading">
      <div className="flex items-start justify-between gap-2">
        <div>
          {space.kind === "property" && (
            <span
              className="mb-1 block h-2 w-12 rounded-sm"
              style={{ background: GROUP_COLORS[space.group] }}
              aria-hidden
            />
          )}
          <h2 id="property-heading" className="font-display text-xl text-brass">
            {space.name}
          </h2>
          <p className="text-xs text-parchment-dim">
            {space.kind === "property"
              ? board.groups[space.group].organization
              : space.kind === "zipline"
                ? "Zipline"
                : space.kind === "utility"
                  ? "Utility"
                  : (SPACE_NOTES[space.kind] ?? "")}
          </p>
        </div>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onClose}>
          Close
        </button>
      </div>

      {space.kind === "tax" && (
        <p className="text-sm">
          Pay {space.amount} {SOULS}.
        </p>
      )}

      {isOwnable(space) && (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
            <dt className="text-parchment-dim">Price</dt>
            <dd className="tabular-nums">
              {space.price} {SOULS}
            </dd>
            {space.kind === "property" && (
              <>
                <dt className="text-parchment-dim">Rent</dt>
                <dd className="tabular-nums">{space.rent[0]}</dd>
                <dt className="text-parchment-dim">With the full set</dt>
                <dd className="tabular-nums">{space.rent[0] * 2}</dd>
                {[1, 2, 3, 4].map((n) => (
                  <RentRow
                    key={n}
                    label={`${n} Guardian${n > 1 ? "s" : ""}`}
                    value={space.rent[n]}
                  />
                ))}
                <RentRow label="Walker" value={space.rent[WALKER]} />
                <dt className="text-parchment-dim">Each building costs</dt>
                <dd className="tabular-nums">{space.buildCost}</dd>
              </>
            )}
            {space.kind === "zipline" &&
              board.ziplineRent.map((rent, i) => (
                <RentRow key={rent} label={`Owning ${i + 1}`} value={rent} />
              ))}
            {space.kind === "utility" && (
              <>
                <dt className="text-parchment-dim">Owning 1</dt>
                <dd>{board.utilityMultiplier[0]}× dice</dd>
                <dt className="text-parchment-dim">Owning both</dt>
                <dd>{board.utilityMultiplier[1]}× dice</dd>
              </>
            )}
            <dt className="text-parchment-dim">Seal value</dt>
            <dd className="tabular-nums">{mortgageValue(board, index)}</dd>
          </dl>
          <p className="text-sm">
            {ownerName ? (
              <>
                Owned by <span className="text-parchment">{ownerName}</span>
                {buildings > 0 &&
                  ` · ${buildings === WALKER ? "a Walker" : `${buildings} Guardian${buildings > 1 ? "s" : ""}`}`}
                {sealed && " · Sealed (no rent)"}
              </>
            ) : (
              <span className="text-parchment-dim">Unowned</span>
            )}
          </p>
        </>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.type}
              type="button"
              className="btn-ghost text-sm"
              disabled={pendingActionId !== null}
              onClick={() => sendAction(action)}
            >
              {actionLabel(action)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function RentRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <>
      <dt className="text-parchment-dim">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  );
}
