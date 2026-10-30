import {
  type BoardDefinition,
  type DeckId,
  getBoard,
  getLegalActions,
  isOwnable,
  type PublicGameState,
  proposalProblem,
  type Trade,
  type TradeBundle,
} from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import { ArrowRightLeft, Plus } from "lucide-react";
import { useState } from "react";
import { sendAction, useConnection } from "../connection";
import { GROUP_COLORS, SOULS } from "../theme";
import { Button } from "../ui/button";
import { Input, Select } from "../ui/field";

type Props = { lobby: LobbySnapshot; game: PublicGameState };

function describeBundle(bundle: TradeBundle, board: BoardDefinition): string {
  const parts = [
    ...(bundle.cash > 0 ? [`${bundle.cash} ${SOULS}`] : []),
    ...bundle.spaces.map((i) => board.spaces[i]?.name ?? `space ${i}`),
    ...bundle.getOutCards.map(() => "an escape card"),
  ];
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

export function TradesTab({ lobby, game }: Props) {
  const { playerId, pendingActionId } = useConnection();
  const [building, setBuilding] = useState(false);
  const board = getBoard(game.config.boardId);
  const name = (id: string) => lobby.players.find((p) => p.id === id)?.name ?? "Someone";
  const mine = game.trades.filter((t) => t.from === playerId || t.to === playerId);
  const legal = playerId ? getLegalActions(game, playerId) : [];
  const can = (type: string, trade: Trade) =>
    legal.some((a) => a.type === type && "tradeId" in a && a.tradeId === trade.id);
  const me = game.players.find((p) => p.id === playerId);
  const pending = pendingActionId !== null;

  if (building && playerId) {
    return (
      <TradeBuilder lobby={lobby} game={game} myId={playerId} onDone={() => setBuilding(false)} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {me && !me.bankrupt && (
        <Button variant="outline" className="w-full" onClick={() => setBuilding(true)}>
          <Plus />
          New offer
        </Button>
      )}
      {mine.length === 0 && <p className="py-6 text-center text-sm text-muted">No open offers.</p>}
      <ul className="flex flex-col gap-2">
        {mine.map((trade) => (
          <li key={trade.id} className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <ArrowRightLeft className="size-3.5" aria-hidden />
              {trade.from === playerId ? `You → ${name(trade.to)}` : `${name(trade.from)} → you`}
            </p>
            <p className="mt-1">
              {trade.from === playerId ? "You offer" : `${name(trade.from)} offers`}{" "}
              {describeBundle(trade.offer, board)}
            </p>
            <p className="text-muted">
              for {trade.to === playerId ? "your" : `${name(trade.to)}'s`}{" "}
              {describeBundle(trade.request, board)}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {can("acceptTrade", trade) && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={pending}
                  onClick={() => sendAction({ type: "acceptTrade", tradeId: trade.id })}
                >
                  Accept
                </Button>
              )}
              {can("rejectTrade", trade) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => sendAction({ type: "rejectTrade", tradeId: trade.id })}
                >
                  Decline
                </Button>
              )}
              {can("cancelTrade", trade) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => sendAction({ type: "cancelTrade", tradeId: trade.id })}
                >
                  Withdraw
                </Button>
              )}
              {trade.to === playerId && !can("acceptTrade", trade) && (
                <span className="self-center text-xs text-muted">
                  Can't accept during an auction
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const emptyBundle = (): TradeBundle => ({ cash: 0, spaces: [], getOutCards: [] });

function TradeBuilder({ lobby, game, myId, onDone }: Props & { myId: string; onDone: () => void }) {
  const board = getBoard(game.config.boardId);
  const others = game.players.filter((p) => p.id !== myId && !p.bankrupt);
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [offer, setOffer] = useState(emptyBundle);
  const [request, setRequest] = useState(emptyBundle);
  const me = game.players.find((p) => p.id === myId);
  const them = game.players.find((p) => p.id === to);
  if (!me || !them) return <p className="text-sm text-muted">Nobody to trade with.</p>;

  const problem = proposalProblem(game, board, { from: myId, to, offer, request });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        Trade with
        <Select
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setRequest(emptyBundle());
          }}
        >
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {lobby.players.find((lp) => lp.id === p.id)?.name ?? p.name}
            </option>
          ))}
        </Select>
      </label>
      <BundleEditor
        title="You give"
        game={game}
        ownerId={myId}
        cashLimit={me.cash}
        cards={me.getOutCards}
        bundle={offer}
        onChange={setOffer}
      />
      <BundleEditor
        title={`${them.name} gives`}
        game={game}
        ownerId={to}
        cashLimit={them.cash}
        cards={them.getOutCards}
        bundle={request}
        onChange={setRequest}
      />
      {problem && <p className="text-xs text-danger">{problem}</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          disabled={problem !== null}
          onClick={() => {
            sendAction({ type: "proposeTrade", to, offer, request });
            onDone();
          }}
        >
          Send offer
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function BundleEditor({
  title,
  game,
  ownerId,
  cashLimit,
  cards,
  bundle,
  onChange,
}: {
  title: string;
  game: PublicGameState;
  ownerId: string;
  cashLimit: number;
  cards: DeckId[];
  bundle: TradeBundle;
  onChange: (bundle: TradeBundle) => void;
}) {
  const board = getBoard(game.config.boardId);
  const owned = game.owners.flatMap((o, i) => {
    const space = board.spaces[i];
    return o === ownerId && space && isOwnable(space) ? [{ index: i, space }] : [];
  });
  const toggleSpace = (i: number) =>
    onChange({
      ...bundle,
      spaces: bundle.spaces.includes(i)
        ? bundle.spaces.filter((s) => s !== i)
        : [...bundle.spaces, i],
    });

  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-lg border border-line p-3 text-sm">
      <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
        {title}
      </legend>
      <label className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-muted">Souls</span>
        <Input
          className="h-9"
          type="number"
          min={0}
          max={cashLimit}
          step={10}
          value={bundle.cash}
          onChange={(e) =>
            onChange({ ...bundle, cash: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </label>
      {owned.length === 0 && <p className="text-xs text-muted">No properties</p>}
      <ul className="flex max-h-36 flex-col overflow-y-auto">
        {owned.map(({ index, space }) => (
          <li key={index}>
            <label className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={bundle.spaces.includes(index)}
                onChange={() => toggleSpace(index)}
              />
              {space.kind === "property" && (
                <span
                  className="h-3 w-1 shrink-0 rounded-full"
                  style={{ background: GROUP_COLORS[space.group] }}
                  aria-hidden
                />
              )}
              <span className="truncate">
                {space.name}
                {game.sealed[index] && <span className="text-muted"> (sealed)</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {cards.length > 0 && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={bundle.getOutCards.length > 0}
            onChange={(e) =>
              onChange({ ...bundle, getOutCards: e.target.checked ? [cards[0] as DeckId] : [] })
            }
          />
          An escape card
        </label>
      )}
    </fieldset>
  );
}
