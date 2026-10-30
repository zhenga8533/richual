import { HEROES, type HeroId } from "@richual/engine";
import {
  type LobbySettings,
  type LobbySnapshot,
  MAX_PLAYERS,
  TURN_TIMER_OPTIONS,
} from "@richual/protocol";
import type { ReactNode } from "react";
import { send, useConnection } from "../connection";
import { SOULS } from "../theme";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select } from "../ui/field";
import { Switch } from "../ui/radix";
import { ChatPanel } from "./ChatPanel";
import { heroLabel } from "./heroLabel";
import { PlayerAvatar } from "./PlayerAvatar";

const STARTING_CASH_OPTIONS = [1000, 1500, 2000, 2500];

type Limit = LobbySettings["limit"];
const LIMIT_OPTIONS: { label: string; limit: Limit }[] = [
  { label: "Until one player remains", limit: { kind: "none" } },
  ...[10, 15, 20, 30].map((rounds) => ({
    label: `${rounds} rounds`,
    limit: { kind: "rounds", rounds } as Limit,
  })),
  ...[30, 45, 60, 90].map((minutes) => ({
    label: `${minutes} minutes of play`,
    limit: { kind: "minutes", minutes } as Limit,
  })),
];
const limitKey = (limit: Limit) =>
  limit.kind === "none"
    ? "none"
    : limit.kind === "rounds"
      ? `r${limit.rounds}`
      : `m${limit.minutes}`;

/** Picking a mode applies its recommended house rules and length; the host can still adjust them. */
const MODE_PRESETS: Record<LobbySettings["mode"], Partial<LobbySettings>> = {
  classic: {
    mode: "classic",
    doubleOnExactGo: true,
    freeParkingJackpot: true,
    speedDie: false,
    limit: { kind: "none" },
  },
  quick: {
    mode: "quick",
    doubleOnExactGo: false,
    freeParkingJackpot: false,
    speedDie: true,
    limit: { kind: "rounds", rounds: 20 },
  },
};

const MODE_NOTES: Record<LobbySettings["mode"], string> = {
  classic: "Play until everyone else is bankrupt.",
  quick:
    "Two random properties each to start, Walkers after three Guardians, the Speed Die, and the game is scored at the second bankruptcy.",
};

export function Setup({ lobby }: { lobby: LobbySnapshot }) {
  const { playerId } = useConnection();
  const isHost = playerId === lobby.hostId;
  const me = lobby.players.find((p) => p.id === playerId);
  const takenByOthers = new Set(lobby.players.filter((p) => p.id !== playerId).map((p) => p.hero));
  const { settings } = lobby;

  const updateSettings = (patch: Partial<LobbySettings>) =>
    send({ type: "updateSettings", settings: { ...settings, ...patch } });

  return (
    <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card aria-labelledby="players-heading">
          <CardHeader>
            <CardTitle id="players-heading">
              Players ({lobby.players.length}/{MAX_PLAYERS})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {lobby.players.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <PlayerAvatar seat={p.seat} hero={p.hero} name={p.name} online={p.connected} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-medium">
                      {p.name}
                      {p.id === playerId && <Badge>You</Badge>}
                      {p.id === lobby.hostId && <Badge variant="accent">Host</Badge>}
                    </p>
                    <p className="text-xs text-muted">{p.connected ? "Online" : "Offline"}</p>
                  </div>
                  {p.id === playerId ? (
                    <label className="text-sm">
                      <span className="sr-only">Your hero</span>
                      <Select
                        value={me?.hero ?? ""}
                        onChange={(e) => send({ type: "setHero", hero: e.target.value as HeroId })}
                      >
                        {!me?.hero && (
                          <option value="" disabled>
                            Choose a hero
                          </option>
                        )}
                        {HEROES.map((h) => (
                          <option key={h.id} value={h.id} disabled={takenByOthers.has(h.id)}>
                            {h.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ) : (
                    <span className="text-sm text-muted">{heroLabel(p.hero, "No hero")}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <ChatPanel lobby={lobby} />
      </div>

      <Card aria-labelledby="settings-heading" className="h-fit">
        <CardHeader>
          <CardTitle id="settings-heading">Rules</CardTitle>
          {!isHost && <span className="text-xs text-muted">Set by the host</span>}
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <Row label="Mode" hint={MODE_NOTES[settings.mode]}>
            <Select
              value={settings.mode}
              disabled={!isHost}
              onChange={(e) =>
                updateSettings(MODE_PRESETS[e.target.value as LobbySettings["mode"]])
              }
            >
              <option value="classic">Classic</option>
              <option value="quick">Quick</option>
            </Select>
          </Row>
          <Row
            label="Game length"
            hint={
              settings.limit.kind === "none"
                ? undefined
                : "The round in progress finishes, then the richest player wins. Pauses don't count."
            }
          >
            <Select
              value={limitKey(settings.limit)}
              disabled={!isHost}
              onChange={(e) => {
                const option = LIMIT_OPTIONS.find((o) => limitKey(o.limit) === e.target.value);
                if (option) updateSettings({ limit: option.limit });
              }}
            >
              {LIMIT_OPTIONS.map((o) => (
                <option key={limitKey(o.limit)} value={limitKey(o.limit)}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Row>
          <Row
            label="Turn timer"
            hint={
              settings.turnTimerSeconds > 0
                ? "Idle players are auto-played safely. Never trades."
                : undefined
            }
          >
            <Select
              value={settings.turnTimerSeconds}
              disabled={!isHost}
              onChange={(e) => updateSettings({ turnTimerSeconds: Number(e.target.value) })}
            >
              {TURN_TIMER_OPTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {sec === 0 ? "Off" : `${sec} seconds`}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Starting souls">
            <Select
              value={settings.startingCash}
              disabled={!isHost}
              onChange={(e) => updateSettings({ startingCash: Number(e.target.value) })}
            >
              {STARTING_CASH_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} {SOULS}
                </option>
              ))}
            </Select>
          </Row>

          <div className="my-2 border-t border-line" />

          <Toggle
            label="Double salary for landing exactly on the Astral Gate"
            checked={settings.doubleOnExactGo}
            disabled={!isHost}
            onChange={(doubleOnExactGo) => updateSettings({ doubleOnExactGo })}
          />
          <Toggle
            label="Taxes and fines fill the Soul Urn jackpot"
            checked={settings.freeParkingJackpot}
            disabled={!isHost}
            onChange={(freeParkingJackpot) => updateSettings({ freeParkingJackpot })}
          />
          <Toggle
            label="Auction properties nobody buys"
            checked={settings.auctions}
            disabled={!isHost}
            onChange={(auctions) => updateSettings({ auctions })}
          />
          <Toggle
            label="Build evenly, from a limited supply of Guardians and Walkers"
            checked={settings.evenBuilding}
            disabled={!isHost}
            onChange={(evenBuilding) => updateSettings({ evenBuilding })}
          />
          <Toggle
            label="Speed Die from round 2: move 1–3 further, or ★ on to the next unowned property"
            checked={settings.speedDie}
            disabled={!isHost}
            onChange={(speedDie) => updateSettings({ speedDie })}
          />

          <div className="mt-3">
            {isHost ? (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={lobby.players.length < 2}
                onClick={() => send({ type: "startGame" })}
              >
                {lobby.players.length < 2 ? "Waiting for another player…" : "Begin the ritual"}
              </Button>
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-center text-sm text-muted">
                Waiting for the host to start the game…
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="flex flex-col gap-1 py-1.5">
      <span className="flex items-center justify-between gap-3 text-sm">
        {label}
        {children}
      </span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-1.5 text-sm">
      {label}
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}
