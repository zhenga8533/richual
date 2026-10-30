import type { PublicGameState } from "@richual/engine";
import type { LobbySnapshot } from "@richual/protocol";
import {
  Bell,
  BellOff,
  Check,
  Flag,
  Keyboard,
  Link2,
  Pause,
  Play,
  Timer,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useState } from "react";
import { send, useConnection } from "../connection";
import { useSoundSettings } from "../sound";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { cn } from "../ui/cn";
import { PopoverContent, PopoverRoot, PopoverTrigger, Switch } from "../ui/radix";
import { formatDuration, useServerNow } from "./Countdown";

type Props = {
  lobby: LobbySnapshot;
  game: PublicGameState;
  notify: boolean;
  onNotifyChange: (on: boolean) => void;
  onShowShortcuts: () => void;
};

/** Lobby code, round, clock and controls, compact enough for the sidebar. */
export function GameToolbar({ lobby, game, notify, onNotifyChange, onShowShortcuts }: Props) {
  const { playerId, status } = useConnection();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = useServerNow(1000);
  const isHost = playerId === lobby.hostId;
  const playing = game.phase.kind !== "gameOver";
  const { clock } = lobby;
  const played = clock.playMs + (clock.resumedAt === null ? 0 : now - clock.resumedAt);
  const remaining = clock.limitMs === null ? null : clock.limitMs - played;

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/l/${lobby.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the code stays visible to share by hand.
    }
  };

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            status === "open" ? "bg-emerald-500" : "animate-pulse bg-accent",
          )}
          title={status === "open" ? "Connected" : "Reconnecting…"}
          aria-hidden
        />
        <span className="sr-only">{status === "open" ? "Connected" : "Reconnecting…"}</span>
        <span className="font-mono font-semibold tracking-[0.2em]">{lobby.code}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={copyInvite}
          aria-label="Copy invite link"
        >
          {copied ? <Check /> : <Link2 />}
        </Button>
        <span className="ml-auto flex items-center gap-2">
          <span>
            <span className="text-muted">Round</span>{" "}
            <span className="font-semibold tabular-nums">{game.turn.round}</span>
            {game.config.roundLimit !== null && (
              <span className="text-muted">/{game.config.roundLimit}</span>
            )}
          </span>
          <span
            className="flex items-center gap-1 text-muted"
            title="Active play time, excluding pauses"
          >
            <Timer className="size-3.5" aria-hidden />
            <span className="font-semibold tabular-nums text-fg">
              {formatDuration(remaining !== null && game.finalRound === null ? remaining : played)}
            </span>
            {remaining !== null && game.finalRound === null ? "left" : ""}
          </span>
        </span>
      </div>

      {(lobby.paused || (game.finalRound !== null && playing)) && (
        <div className="flex gap-2">
          {lobby.paused && (
            <Badge variant="solid" role="status">
              Paused
            </Badge>
          )}
          {game.finalRound !== null && playing && <Badge variant="accent">Final round</Badge>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-line pt-2">
        <SoundControl />
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={notify}
          aria-label={notify ? "Desktop notifications on" : "Desktop notifications off"}
          title="Notify me when it's my move while this tab is in the background"
          onClick={() => onNotifyChange(!notify)}
        >
          {notify ? <Bell /> : <BellOff />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={onShowShortcuts}
        >
          <Keyboard />
        </Button>
        {isHost && playing && (
          <span className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => send({ type: lobby.paused ? "resume" : "pause" })}
            >
              {lobby.paused ? <Play /> : <Pause />}
              {lobby.paused ? "Resume" : "Pause"}
            </Button>
            {confirmEnd ? (
              <>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    send({ type: "endGame" });
                    setConfirmEnd(false);
                  }}
                >
                  End and score now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(false)}>
                  Keep playing
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(true)}>
                <Flag />
                End game
              </Button>
            )}
          </span>
        )}
      </div>
    </Card>
  );
}

function SoundControl() {
  const { volume, muted } = useSoundSettings();
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={muted ? "Sound off" : "Sound settings"}>
          <Icon />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-64">
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center justify-between gap-3 font-medium">
            Sound effects
            <Switch
              checked={!muted}
              onCheckedChange={(on) => useSoundSettings.setState({ muted: !on })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-muted">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              disabled={muted}
              onChange={(e) => useSoundSettings.setState({ volume: Number(e.target.value) })}
              className="accent-[var(--accent)]"
            />
          </label>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
