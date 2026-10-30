import type { PublicGameState } from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import { useState } from "react";
import { send, useConnection } from "../connection";
import { formatDuration, useServerNow } from "./Countdown";

type Props = {
  lobby: LobbySnapshot;
  game: PublicGameState;
  alertsOn: boolean;
  onAlertsChange: (on: boolean) => void;
};

/** Round, clock and host controls along the top of the game. */
export function GameBar({ lobby, game, alertsOn, onAlertsChange }: Props) {
  const { playerId } = useConnection();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const now = useServerNow(1000);
  const isHost = playerId === lobby.hostId;
  const playing = game.phase.kind !== "gameOver";
  const { clock } = lobby;
  const played = clock.playMs + (clock.resumedAt === null ? 0 : now - clock.resumedAt);
  const remaining = clock.limitMs === null ? null : clock.limitMs - played;

  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
      <span>
        Round <span className="tabular-nums text-parchment">{game.turn.round}</span>
        {game.config.roundLimit !== null && (
          <span className="text-parchment-dim"> of {game.config.roundLimit}</span>
        )}
      </span>
      <span className="text-parchment-dim" title="Active play time, excluding pauses">
        {remaining !== null && game.finalRound === null ? (
          <>
            <span className="tabular-nums text-parchment">{formatDuration(remaining)}</span> left
          </>
        ) : (
          <>
            <span className="tabular-nums text-parchment">{formatDuration(played)}</span> played
          </>
        )}
      </span>
      {game.finalRound !== null && playing && (
        <span className="rounded-sm border border-amber px-2 text-amber">Final round</span>
      )}
      {lobby.paused && (
        <span className="rounded-sm bg-amber px-2 font-semibold text-ink" role="status">
          Paused
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-parchment-dim">
          <input
            type="checkbox"
            className="accent-amber"
            checked={alertsOn}
            onChange={(e) => onAlertsChange(e.target.checked)}
          />
          Alert me when it's my move
        </label>
        {isHost && playing && (
          <>
            <button
              type="button"
              className="btn-ghost px-3 py-1 text-sm"
              onClick={() => send({ type: lobby.paused ? "resume" : "pause" })}
            >
              {lobby.paused ? "Resume" : "Pause"}
            </button>
            {confirmEnd ? (
              <>
                <button
                  type="button"
                  className="btn border-blood bg-blood px-3 py-1 text-sm text-parchment"
                  onClick={() => {
                    send({ type: "endGame" });
                    setConfirmEnd(false);
                  }}
                >
                  End and score now
                </button>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1 text-sm"
                  onClick={() => setConfirmEnd(false)}
                >
                  Keep playing
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-ghost px-3 py-1 text-sm"
                onClick={() => setConfirmEnd(true)}
              >
                End game
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
