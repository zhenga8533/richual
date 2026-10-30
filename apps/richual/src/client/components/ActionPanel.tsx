import { type Action, getBoard, getLegalActions, type PublicGameState } from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import { type FormEvent, useState } from "react";
import { sendAction, useConnection } from "../connection";
import { SOULS } from "../theme";
import { Countdown } from "./Countdown";

type Props = { lobby: LobbySnapshot; game: PublicGameState };

const FLOW_ACTIONS = new Set<Action["type"]>([
  "roll",
  "payJailFine",
  "useGetOutCard",
  "buy",
  "decline",
  "endTurn",
]);

function useNames(lobby: LobbySnapshot) {
  return (id: string) =>
    id === "bank"
      ? "the bank"
      : id === "urn"
        ? "the Soul Urn"
        : (lobby.players.find((p) => p.id === id)?.name ?? "Someone");
}

/** What the viewer can do right now: the turn, an auction, or raising funds. */
export function ActionPanel({ lobby, game }: Props) {
  if (lobby.paused) {
    return (
      <section className="panel p-4" aria-label="Your actions">
        <p className="text-sm text-parchment-dim" aria-live="polite">
          The host has paused the game. You can still offer and decline trades.
        </p>
      </section>
    );
  }
  const panel =
    game.phase.kind === "auction" ? (
      <AuctionPanel lobby={lobby} game={game} />
    ) : game.phase.kind === "raisingFunds" ? (
      <DebtPanel lobby={lobby} game={game} />
    ) : (
      <TurnPanel lobby={lobby} game={game} />
    );
  return (
    <div className="relative">
      {panel}
      {lobby.actionDeadline !== null && (
        <div className="absolute top-3 right-4">
          <Countdown deadline={lobby.actionDeadline} />
        </div>
      )}
    </div>
  );
}

function flowLabel(action: Action, game: PublicGameState): string {
  const board = getBoard(game.config.boardId);
  switch (action.type) {
    case "roll":
      return "Roll dice";
    case "buy": {
      const space = game.phase.kind === "awaitingBuy" ? board.spaces[game.phase.space] : undefined;
      return space && "price" in space ? `Buy for ${space.price} ${SOULS}` : "Buy";
    }
    case "decline":
      return game.config.auctions ? "Pass to auction" : "Pass";
    case "endTurn":
      return "End turn";
    case "payJailFine":
      return `Pay ${game.config.jailFine} ${SOULS} fine`;
    case "useGetOutCard":
      return "Use escape card";
    default:
      return action.type;
  }
}

function TurnPanel({ lobby, game }: Props) {
  const { playerId, pendingActionId } = useConnection();
  const name = useNames(lobby);
  const current = game.players[game.turn.playerIndex];
  const board = getBoard(game.config.boardId);
  const legal = playerId ? getLegalActions(game, playerId) : [];
  const flow = legal.filter((a) => FLOW_ACTIONS.has(a.type));
  const offered = game.phase.kind === "awaitingBuy" ? board.spaces[game.phase.space] : undefined;
  const canManage = legal.some((a) => "space" in a);

  if (current?.id !== playerId) {
    return (
      <section className="panel p-4" aria-label="Your actions">
        <p className="text-sm text-parchment-dim" aria-live="polite">
          Waiting for <span className="text-parchment">{current ? name(current.id) : "…"}</span>…
        </p>
      </section>
    );
  }

  return (
    <section className="panel flex flex-col gap-3 p-4" aria-label="Your actions">
      <h2 className="font-display text-xl text-brass">Your turn</h2>
      {offered && <p className="text-sm">{offered.name} is unowned.</p>}
      <div className="flex flex-wrap gap-2">
        {flow.map((action, i) => (
          <button
            key={action.type}
            type="button"
            className={i === 0 ? "btn-primary" : "btn-ghost"}
            disabled={pendingActionId !== null}
            onClick={() => sendAction(action)}
          >
            {flowLabel(action, game)}
          </button>
        ))}
      </div>
      {canManage && (
        <p className="text-xs text-parchment-dim">
          Select one of your properties on the board to build, sell or seal.
        </p>
      )}
    </section>
  );
}

function AuctionPanel({ lobby, game }: Props) {
  const { playerId, pendingActionId } = useConnection();
  const [custom, setCustom] = useState("");
  const name = useNames(lobby);
  const { phase } = game;
  if (phase.kind !== "auction") return null;
  const space = getBoard(game.config.boardId).spaces[phase.space];
  const me = game.players.find((p) => p.id === playerId);
  const legal = playerId ? getLegalActions(game, playerId) : [];
  const canBid = legal.some((a) => a.type === "bid");
  const canPass = legal.some((a) => a.type === "passAuction");
  const minBid = phase.highBid + 1;
  const quickBids = [
    ...new Set([minBid, phase.highBid + 10, phase.highBid + 50, phase.highBid + 100]),
  ].filter((b) => b <= (me?.cash ?? 0));
  const pending = pendingActionId !== null;

  const bid = (amount: number) => sendAction({ type: "bid", amount });
  const onCustom = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(custom);
    if (Number.isInteger(amount) && amount >= minBid) {
      bid(amount);
      setCustom("");
    }
  };

  return (
    <section className="panel flex flex-col gap-3 p-4" aria-label="Auction" aria-live="polite">
      <h2 className="font-display text-xl text-brass">Auction: {space?.name}</h2>
      <p className="text-sm">
        {phase.highBidder ? (
          <>
            High bid{" "}
            <span className="tabular-nums text-amber">
              {phase.highBid} {SOULS}
            </span>{" "}
            by {phase.highBidder === playerId ? "you" : name(phase.highBidder)}
          </>
        ) : (
          "No bids yet"
        )}
      </p>
      <p className="text-xs text-parchment-dim">
        Still bidding: {phase.bidders.map((id) => (id === playerId ? "you" : name(id))).join(", ")}
      </p>
      {canBid && (
        <>
          <div className="flex flex-wrap gap-2">
            {quickBids.map((amount, i) => (
              <button
                key={amount}
                type="button"
                className={i === 0 ? "btn-primary" : "btn-ghost"}
                disabled={pending}
                onClick={() => bid(amount)}
              >
                Bid {amount} {SOULS}
              </button>
            ))}
          </div>
          <form onSubmit={onCustom} className="flex gap-2">
            <label className="sr-only" htmlFor="custom-bid">
              Custom bid
            </label>
            <input
              id="custom-bid"
              className="input"
              type="number"
              min={minBid}
              max={me?.cash}
              step={1}
              placeholder={`${minBid} or more`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button type="submit" className="btn-ghost" disabled={pending || custom === ""}>
              Bid
            </button>
          </form>
        </>
      )}
      {canPass && (
        <button
          type="button"
          className="btn-ghost self-start"
          disabled={pending}
          onClick={() => sendAction({ type: "passAuction" })}
        >
          Drop out
        </button>
      )}
      {!canBid && !canPass && (
        <p className="text-sm text-parchment-dim">
          {phase.highBidder === playerId
            ? "You hold the high bid. Waiting for the others…"
            : "You are not bidding."}
        </p>
      )}
    </section>
  );
}

function DebtPanel({ lobby, game }: Props) {
  const { playerId, pendingActionId } = useConnection();
  const [confirming, setConfirming] = useState(false);
  const name = useNames(lobby);
  const debt = game.debts[0];
  if (!debt) return null;
  const me = game.players.find((p) => p.id === playerId);
  const legal = playerId ? getLegalActions(game, playerId) : [];
  const pending = pendingActionId !== null;

  if (debt.debtor !== playerId) {
    return (
      <section className="panel p-4" aria-label="Raising funds" aria-live="polite">
        <p className="text-sm text-parchment-dim">
          Waiting for <span className="text-parchment">{name(debt.debtor)}</span> to raise{" "}
          {debt.amount} {SOULS} for {name(debt.creditor)}…
        </p>
      </section>
    );
  }

  return (
    <section
      className="panel flex flex-col gap-3 p-4"
      aria-label="Raising funds"
      aria-live="polite"
    >
      <h2 className="font-display text-xl text-blood">You are short of souls</h2>
      <p className="text-sm">
        You owe {name(debt.creditor)}{" "}
        <span className="tabular-nums text-amber">
          {debt.amount} {SOULS}
        </span>{" "}
        and hold{" "}
        <span className="tabular-nums">
          {me?.cash ?? 0} {SOULS}
        </span>
        .
      </p>
      <p className="text-xs text-parchment-dim">
        Select your properties on the board to sell buildings or seal them, or offer a trade.
      </p>
      <div className="flex flex-wrap gap-2">
        {legal.some((a) => a.type === "payDebt") && (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() => sendAction({ type: "payDebt" })}
          >
            Pay {debt.amount} {SOULS}
          </button>
        )}
        {confirming ? (
          <>
            <button
              type="button"
              className="btn border-blood bg-blood text-parchment"
              disabled={pending}
              onClick={() => sendAction({ type: "declareBankruptcy" })}
            >
              Confirm bankruptcy
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
              Keep trying
            </button>
          </>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}>
            Declare bankruptcy
          </button>
        )}
      </div>
    </section>
  );
}
