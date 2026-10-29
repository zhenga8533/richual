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
import { useState } from "react";
import { sendAction, useConnection } from "../connection";
import { SOULS } from "../theme";

type Props = { lobby: LobbySnapshot; game: PublicGameState };

function describeBundle(bundle: TradeBundle, board: BoardDefinition): string {
  const parts = [
    ...(bundle.cash > 0 ? [`${bundle.cash} ${SOULS}`] : []),
    ...bundle.spaces.map((i) => board.spaces[i]?.name ?? `space ${i}`),
    ...bundle.getOutCards.map(() => "an escape card"),
  ];
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

export function TradePanel({ lobby, game }: Props) {
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

  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="trades-heading">
      <div className="flex items-center justify-between">
        <h2 id="trades-heading" className="font-display text-lg">
          Trades
        </h2>
        {me && !me.bankrupt && !building && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-sm"
            onClick={() => setBuilding(true)}
          >
            New offer
          </button>
        )}
      </div>

      {building && playerId && (
        <TradeBuilder lobby={lobby} game={game} myId={playerId} onDone={() => setBuilding(false)} />
      )}

      {mine.length === 0 && !building && (
        <p className="text-sm text-parchment-dim">No open offers.</p>
      )}
      <ul className="flex flex-col gap-3">
        {mine.map((trade) => (
          <li key={trade.id} className="rounded-sm border border-brass-dim/40 p-2 text-sm">
            <p>
              {trade.from === playerId ? "You offer" : `${name(trade.from)} offers`}{" "}
              {describeBundle(trade.offer, board)}
            </p>
            <p>
              for {trade.to === playerId ? "your" : `${name(trade.to)}'s`}{" "}
              {describeBundle(trade.request, board)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {can("acceptTrade", trade) && (
                <button
                  type="button"
                  className="btn-primary px-3 py-1 text-sm"
                  disabled={pending}
                  onClick={() => sendAction({ type: "acceptTrade", tradeId: trade.id })}
                >
                  Accept
                </button>
              )}
              {can("rejectTrade", trade) && (
                <button
                  type="button"
                  className="btn-ghost px-3 py-1 text-sm"
                  disabled={pending}
                  onClick={() => sendAction({ type: "rejectTrade", tradeId: trade.id })}
                >
                  Decline
                </button>
              )}
              {can("cancelTrade", trade) && (
                <button
                  type="button"
                  className="btn-ghost px-3 py-1 text-sm"
                  disabled={pending}
                  onClick={() => sendAction({ type: "cancelTrade", tradeId: trade.id })}
                >
                  Withdraw
                </button>
              )}
              {trade.to === playerId && !can("acceptTrade", trade) && (
                <span className="text-xs text-parchment-dim">Can't accept during an auction</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
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
  if (!me || !them) return <p className="text-sm text-parchment-dim">Nobody to trade with.</p>;

  const problem = proposalProblem(game, board, { from: myId, to, offer, request });

  const submit = () => {
    sendAction({ type: "proposeTrade", to, offer, request });
    onDone();
  };

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-brass-dim/60 p-3">
      <label className="flex items-center justify-between gap-2 text-sm">
        Trade with
        <select
          className="input w-auto py-1"
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
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
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
      </div>
      {problem && <p className="text-xs text-blood">{problem}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={problem !== null}
          onClick={submit}
        >
          Send offer
        </button>
        <button type="button" className="btn-ghost text-sm" onClick={onDone}>
          Cancel
        </button>
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
  const cardsOffered = bundle.getOutCards.length;

  return (
    <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
      <legend className="mb-1 font-medium text-brass">{title}</legend>
      <label className="flex items-center gap-2">
        <span className="shrink-0">Souls</span>
        <input
          className="input py-1"
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
      {owned.length === 0 && <p className="text-xs text-parchment-dim">No properties</p>}
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {owned.map(({ index, space }) => (
          <li key={index}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-amber"
                checked={bundle.spaces.includes(index)}
                onChange={() => toggleSpace(index)}
              />
              <span className="truncate">
                {space.name}
                {game.sealed[index] && <span className="text-parchment-dim"> (sealed)</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {cards.length > 0 && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-amber"
            checked={cardsOffered > 0}
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
