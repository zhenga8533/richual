import {
  type Action,
  getBoard,
  getLegalActions,
  type PublicGameState,
  type Standing,
} from "@richual/engine";
import { AUCTION_TIMER_SECONDS, type LobbySnapshot } from "@richual/protocol";
import { Pause } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { send, sendAction, useConnection } from "../connection";
import { primaryAction } from "../shortcuts";
import { SOULS } from "../theme";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/field";
import { Countdown, useServerNow } from "./Countdown";

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

/**
 * The one place the game asks something of you: your turn, an auction, a debt,
 * or the result. `attention` changes each time the game starts waiting on you,
 * replaying a brief highlight.
 */
export function ActionCard({ lobby, game, attention }: Props & { attention: number }) {
  let body: ReactNode;
  if (game.phase.kind === "gameOver") {
    body = (
      <GameOver
        lobby={lobby}
        winnerId={game.phase.winnerId}
        reason={game.phase.reason}
        standings={game.phase.standings}
      />
    );
  } else if (lobby.paused) {
    body = (
      <Shell title="Paused" icon={<Pause className="size-4 text-muted" />}>
        <p className="text-sm text-muted" aria-live="polite">
          The host has paused the game. You can still offer and decline trades.
        </p>
      </Shell>
    );
  } else if (game.phase.kind === "auction") {
    body = <Auction lobby={lobby} game={game} />;
  } else if (game.phase.kind === "raisingFunds") {
    body = <Debt lobby={lobby} game={game} />;
  } else {
    body = <Turn lobby={lobby} game={game} />;
  }
  return (
    <Card
      key={attention}
      aria-label="Your actions"
      className={`relative ${attention > 0 ? "attention" : ""}`}
    >
      {body}
      {lobby.actionDeadline !== null && game.phase.kind !== "gameOver" && (
        <div className="absolute top-4 right-4">
          <Countdown deadline={lobby.actionDeadline} />
        </div>
      )}
    </Card>
  );
}

function Shell({
  title,
  icon,
  tone = "default",
  children,
}: {
  title: string;
  icon?: ReactNode;
  tone?: "default" | "accent" | "danger";
  children: ReactNode;
}) {
  const color = { default: "text-fg", accent: "text-accent-text", danger: "text-danger" }[tone];
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className={`flex items-center gap-2 pr-16 text-base font-semibold ${color}`}>
        {icon}
        {title}
      </h2>
      {children}
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

function Turn({ lobby, game }: Props) {
  const { playerId, pendingActionId } = useConnection();
  const name = useNames(lobby);
  const current = game.players[game.turn.playerIndex];
  const board = getBoard(game.config.boardId);
  const legal = playerId ? getLegalActions(game, playerId) : [];
  const flow = legal.filter((a) => FLOW_ACTIONS.has(a.type));
  const offered = game.phase.kind === "awaitingBuy" ? board.spaces[game.phase.space] : undefined;
  const canManage = legal.some((a) => "space" in a);
  const primary = primaryAction(legal);

  if (current?.id !== playerId) {
    return (
      <Shell title={`${current ? name(current.id) : "…"}'s turn`}>
        <p className="text-sm text-muted" aria-live="polite">
          Waiting for <span className="text-fg">{current ? name(current.id) : "…"}</span>…
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Your turn" tone="accent">
      {offered && (
        <p className="text-sm">
          <span className="font-medium">{offered.name}</span>{" "}
          <span className="text-muted">is unowned.</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {flow.map((action, i) => (
          <Button
            key={action.type}
            variant={i === 0 ? "primary" : "outline"}
            size="lg"
            className={i === 0 ? "min-w-36 flex-1" : ""}
            disabled={pendingActionId !== null}
            onClick={() => sendAction(action)}
          >
            {flowLabel(action, game)}
            {action === primary && (
              <kbd
                className="hidden rounded border border-current/40 px-1 text-[10px] font-normal sm:inline"
                aria-hidden
              >
                Space
              </kbd>
            )}
          </Button>
        ))}
      </div>
      {canManage && (
        <p className="text-xs text-muted">
          Select one of your properties on the board to build, sell or seal.
        </p>
      )}
    </Shell>
  );
}

function Auction({ lobby, game }: Props) {
  const { playerId, pendingActionId } = useConnection();
  const [custom, setCustom] = useState("");
  const name = useNames(lobby);
  const now = useServerNow(100);
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
  const timeLeft =
    lobby.actionDeadline === null
      ? null
      : Math.max(0, Math.min(1, (lobby.actionDeadline - now) / (AUCTION_TIMER_SECONDS * 1000)));

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
    <Shell title={`Auction: ${space?.name ?? ""}`} tone="accent">
      <div className="flex items-baseline justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
        <span className="text-sm text-muted">
          {phase.highBidder
            ? `High bid by ${phase.highBidder === playerId ? "you" : name(phase.highBidder)}`
            : "No bids yet"}
        </span>
        <span className="text-lg font-semibold tabular-nums text-accent-text">
          {phase.highBid} {SOULS}
        </span>
      </div>
      {timeLeft !== null && (
        <div
          className="h-1 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="Time left in the auction"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(timeLeft * 100)}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
              timeLeft < 0.3 ? "bg-danger" : "bg-accent"
            }`}
            style={{ width: `${timeLeft * 100}%` }}
          />
        </div>
      )}
      <p className="text-xs text-muted">
        Still bidding: {phase.bidders.map((id) => (id === playerId ? "you" : name(id))).join(", ")}
      </p>
      {canBid && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {quickBids.map((amount, i) => (
              <Button
                key={amount}
                variant={i === 0 ? "primary" : "outline"}
                disabled={pending}
                onClick={() => bid(amount)}
              >
                Bid {amount} {SOULS}
              </Button>
            ))}
          </div>
          <form onSubmit={onCustom} className="flex gap-2">
            <label className="sr-only" htmlFor="custom-bid">
              Custom bid
            </label>
            <Input
              id="custom-bid"
              type="number"
              min={minBid}
              max={me?.cash}
              step={1}
              placeholder={`${minBid} or more`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={pending || custom === ""}>
              Bid
            </Button>
          </form>
        </>
      )}
      {canPass && (
        <Button
          variant="ghost"
          className="self-start"
          disabled={pending}
          onClick={() => sendAction({ type: "passAuction" })}
        >
          Drop out
        </Button>
      )}
      {!canBid && !canPass && (
        <p className="text-sm text-muted">
          {phase.highBidder === playerId
            ? "You hold the high bid. Waiting for the others…"
            : "You are not bidding."}
        </p>
      )}
    </Shell>
  );
}

function Debt({ lobby, game }: Props) {
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
      <Shell title="Raising funds">
        <p className="text-sm text-muted" aria-live="polite">
          Waiting for <span className="text-fg">{name(debt.debtor)}</span> to raise {debt.amount}{" "}
          {SOULS} for {name(debt.creditor)}…
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="You are short of souls" tone="danger">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <p className="text-xs text-muted">You owe {name(debt.creditor)}</p>
          <p className="text-lg font-semibold tabular-nums text-danger">
            {debt.amount} {SOULS}
          </p>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <p className="text-xs text-muted">You hold</p>
          <p className="text-lg font-semibold tabular-nums">
            {me?.cash ?? 0} {SOULS}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted">
        Select your properties on the board to sell buildings or seal them, or offer a trade.
      </p>
      <div className="flex flex-wrap gap-2">
        {legal.some((a) => a.type === "payDebt") && (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => sendAction({ type: "payDebt" })}
          >
            Pay {debt.amount} {SOULS}
          </Button>
        )}
        {confirming ? (
          <>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => sendAction({ type: "declareBankruptcy" })}
            >
              Confirm bankruptcy
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep trying
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Declare bankruptcy
          </Button>
        )}
      </div>
    </Shell>
  );
}

const END_REASONS: Record<string, string> = {
  lastStanding: "Every rival is soul-bankrupt.",
  bankruptcies: "The bankruptcy limit was reached; ranked by net worth.",
  roundLimit: "The round limit was reached; ranked by net worth.",
  timeLimit: "Time ran out and the final round finished; ranked by net worth.",
  endedEarly: "The host ended the game early. This is a provisional result by net worth.",
};

function GameOver({
  lobby,
  winnerId,
  reason,
  standings,
}: {
  lobby: LobbySnapshot;
  winnerId: string;
  reason: string;
  standings: Standing[];
}) {
  const { playerId } = useConnection();
  const name = useNames(lobby);
  return (
    <div className="flex flex-col gap-4 p-5" aria-live="polite">
      <div>
        <h2 className="font-display text-3xl text-accent-text">
          {winnerId === playerId ? "You win the ritual!" : `${name(winnerId)} wins!`}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          {reason === "endedEarly" && <Badge variant="accent">Provisional</Badge>}
          {END_REASONS[reason]}
        </p>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Final standings</caption>
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="py-1.5 font-medium">
              #
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Player
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Souls
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Holdings
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Buildings
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Net worth
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((st) => (
            <tr
              key={st.playerId}
              className={`border-b border-line last:border-0 ${st.bankrupt ? "text-muted" : ""}`}
            >
              <td className="py-2">{st.rank}</td>
              <td className={`py-2 ${st.playerId === playerId ? "font-semibold" : ""}`}>
                {name(st.playerId)}
                {st.bankrupt && <span className="text-muted"> (bankrupt)</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{st.cash}</td>
              <td className="py-2 text-right tabular-nums">{st.propertyValue}</td>
              <td className="py-2 text-right tabular-nums">{st.buildingValue}</td>
              <td className="py-2 text-right font-semibold tabular-nums text-accent-text">
                {st.netWorth} {SOULS}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {playerId === lobby.hostId ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => send({ type: "rematch" })}>
            Rematch
          </Button>
          <Button variant="outline" onClick={() => send({ type: "returnToLobby" })}>
            Back to lobby
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">The host can start another game.</p>
      )}
    </div>
  );
}
