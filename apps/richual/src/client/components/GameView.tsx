import { getBoard, getLegalActions, type PublicGameState, type Standing } from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import { useEffect, useRef, useState } from "react";
import { useAlertPreference, useNeedsYouAlert } from "../alerts";
import { type LoggedEvent, send, useConnection } from "../connection";
import { describeEvent } from "../describe";
import { initials, SOULS, seatColor } from "../theme";
import { ActionPanel } from "./ActionPanel";
import { Board } from "./Board";
import { ChatPanel } from "./ChatPanel";
import { GameBar } from "./GameBar";
import { heroLabel } from "./heroLabel";
import { PropertyPanel } from "./PropertyPanel";
import { TradePanel } from "./TradePanel";

export function GameView({ lobby, game }: { lobby: LobbySnapshot; game: PublicGameState }) {
  const { playerId, log } = useConnection();
  const [selected, setSelected] = useState<number | null>(null);
  const [alertsOn, setAlertsOn] = useAlertPreference();
  const lastDraw = log.findLast((l) => l.event.type === "cardDrawn");
  const lastCard =
    lastDraw?.event.type === "cardDrawn"
      ? { seq: lastDraw.seq, deck: lastDraw.event.deck, cardId: lastDraw.event.cardId }
      : null;
  // Anything but withdrawing your own offer means the game is waiting on you.
  const needsMe =
    !lobby.paused &&
    playerId !== null &&
    getLegalActions(game, playerId).some((a) => a.type !== "cancelTrade");

  useNeedsYouAlert(needsMe, alertsOn, "It's your move.");
  useEffect(() => {
    document.title = needsMe ? `${SOULS} Your move — Richual` : "Richual";
    return () => {
      document.title = "Richual";
    };
  }, [needsMe]);

  return (
    <div className="grid w-full max-w-7xl grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="lg:col-span-2">
        <GameBar lobby={lobby} game={game} alertsOn={alertsOn} onAlertsChange={setAlertsOn} />
      </div>
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-10rem))]">
        <Board
          game={game}
          players={lobby.players}
          myId={playerId}
          selected={selected}
          onSelect={(space) => setSelected(space === selected ? null : space)}
          lastCard={lastCard}
        />
      </div>
      <aside className="flex min-w-0 flex-col gap-4">
        {game.phase.kind === "gameOver" ? (
          <GameOver
            lobby={lobby}
            winnerId={game.phase.winnerId}
            reason={game.phase.reason}
            standings={game.phase.standings}
          />
        ) : (
          <ActionPanel lobby={lobby} game={game} />
        )}
        {selected !== null && (
          <PropertyPanel
            lobby={lobby}
            game={game}
            space={selected}
            onClose={() => setSelected(null)}
          />
        )}
        <Players lobby={lobby} game={game} />
        {game.phase.kind !== "gameOver" && <TradePanel lobby={lobby} game={game} />}
        <EventLog log={log} lobby={lobby} game={game} />
        <ChatPanel lobby={lobby} />
      </aside>
    </div>
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
  const name = (id: string) => lobby.players.find((p) => p.id === id)?.name ?? "Someone";
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-live="polite">
      <h2 className="font-display text-2xl text-brass">
        {winnerId === playerId ? "You win the ritual!" : `${name(winnerId)} wins!`}
        {reason === "endedEarly" && (
          <span className="ml-2 align-middle text-xs text-amber">Provisional</span>
        )}
      </h2>
      <p className="text-sm text-parchment-dim">{END_REASONS[reason]}</p>
      <table className="w-full text-sm">
        <caption className="sr-only">Final standings</caption>
        <thead className="text-left text-xs text-parchment-dim">
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col" className="text-right">
              Souls
            </th>
            <th scope="col" className="text-right">
              Holdings
            </th>
            <th scope="col" className="text-right">
              Buildings
            </th>
            <th scope="col" className="text-right">
              Net worth
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((st) => (
            <tr key={st.playerId} className={st.bankrupt ? "opacity-50" : ""}>
              <td>{st.rank}</td>
              <td className={st.playerId === playerId ? "font-semibold" : ""}>
                {name(st.playerId)}
                {st.bankrupt && <span className="text-parchment-dim"> (bankrupt)</span>}
              </td>
              <td className="text-right tabular-nums">{st.cash}</td>
              <td className="text-right tabular-nums">{st.propertyValue}</td>
              <td className="text-right tabular-nums">{st.buildingValue}</td>
              <td className="text-right tabular-nums text-amber">
                {st.netWorth} {SOULS}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {playerId === lobby.hostId ? (
        <button
          type="button"
          className="btn-primary"
          onClick={() => send({ type: "returnToLobby" })}
        >
          Back to lobby
        </button>
      ) : (
        <p className="text-sm text-parchment-dim">The host can start another game.</p>
      )}
    </section>
  );
}

function Players({ lobby, game }: { lobby: LobbySnapshot; game: PublicGameState }) {
  const { playerId } = useConnection();
  const current = game.players[game.turn.playerIndex];
  return (
    <section className="panel p-4" aria-labelledby="game-players">
      <h2 id="game-players" className="mb-2 font-display text-lg">
        Players
      </h2>
      <ul className="flex flex-col gap-2">
        {game.players.map((p) => {
          const info = lobby.players.find((lp) => lp.id === p.id);
          const owned = game.owners.filter((o) => o === p.id).length;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-3 rounded-sm px-2 py-1 ${
                p.id === current?.id ? "bg-smoke-light" : ""
              } ${p.bankrupt ? "opacity-50" : ""}`}
            >
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-ink"
                style={{ background: seatColor(info?.seat ?? 0) }}
                aria-hidden
              >
                {initials(heroLabel(info?.hero ?? null, p.name))}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`truncate ${p.id === playerId ? "font-semibold" : ""}`}>
                  {p.name}
                  {p.id === playerId && <span className="text-parchment-dim"> (you)</span>}
                </p>
                <p className="text-xs text-parchment-dim">
                  {heroLabel(info?.hero ?? null, "")} · {owned} owned
                  {p.inJail && " · in the Lost Whisper"}
                  {p.getOutCards.length > 0 && ` · ${p.getOutCards.length} escape card`}
                  {p.bankrupt && " · bankrupt"}
                  {info && !info.connected && " · offline"}
                </p>
              </div>
              <span className="tabular-nums text-amber">
                {p.cash} {SOULS}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EventLog({
  log,
  lobby,
  game,
}: {
  log: LoggedEvent[];
  lobby: LobbySnapshot;
  game: PublicGameState;
}) {
  const board = getBoard(game.config.boardId);
  const name = (id: string) => lobby.players.find((p) => p.id === id)?.name ?? "Someone";
  const lines = log
    // Banishment already says where the player went.
    .filter((l, i) => !(l.event.type === "moved" && log[i + 1]?.event.type === "sentToJail"))
    .map(({ seq, event }) => ({ seq, text: describeEvent(event, name, board), event }))
    .filter((l): l is typeof l & { text: string } => l.text !== null);
  const end = useRef<HTMLLIElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever new events arrive
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [log]);

  return (
    <section className="panel flex max-h-80 min-h-40 flex-col p-4" aria-labelledby="game-log">
      <h2 id="game-log" className="mb-2 font-display text-lg">
        Ritual log
      </h2>
      <ol className="flex-1 space-y-1 overflow-y-auto text-sm" aria-live="polite">
        {lines.length === 0 && <li className="text-parchment-dim">Nothing has happened yet.</li>}
        {lines.map((l) => (
          <li
            key={l.seq}
            className={
              l.event.type === "turnStarted"
                ? "mt-2 border-t border-brass-dim/40 pt-1 text-xs uppercase tracking-wider text-brass"
                : "text-parchment"
            }
          >
            {l.text}
          </li>
        ))}
        <li ref={end} aria-hidden />
      </ol>
    </section>
  );
}
