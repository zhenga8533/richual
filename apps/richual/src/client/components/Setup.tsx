import { HEROES, type HeroId } from "@richual/engine";
import {
  type LobbySettings,
  type LobbySnapshot,
  MAX_PLAYERS,
  TURN_TIMER_OPTIONS,
} from "@richual/protocol";
import { send, useConnection } from "../connection";
import { initials, SOULS, seatColor } from "../theme";
import { ChatPanel } from "./ChatPanel";
import { heroLabel } from "./heroLabel";

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
    limit: { kind: "none" },
  },
  quick: {
    mode: "quick",
    doubleOnExactGo: false,
    freeParkingJackpot: false,
    limit: { kind: "rounds", rounds: 20 },
  },
};

const MODE_NOTES: Record<LobbySettings["mode"], string> = {
  classic: "Play until everyone else is bankrupt.",
  quick:
    "Two random properties each to start, Walkers after three Guardians, and the game is scored at the second bankruptcy.",
};

export function Setup({ lobby }: { lobby: LobbySnapshot }) {
  const { playerId } = useConnection();
  const isHost = playerId === lobby.hostId;
  const me = lobby.players.find((p) => p.id === playerId);
  const takenByOthers = new Set(lobby.players.filter((p) => p.id !== playerId).map((p) => p.hero));

  const updateSettings = (patch: Partial<LobbySettings>) =>
    send({ type: "updateSettings", settings: { ...lobby.settings, ...patch } });

  return (
    <div className="flex w-full flex-col gap-4">
      <section className="panel p-5" aria-labelledby="players-heading">
        <h2 id="players-heading" className="mb-3 font-display text-xl">
          Players ({lobby.players.length}/{MAX_PLAYERS})
        </h2>
        <ul className="flex flex-col gap-2">
          {lobby.players.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <span
                className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-ink"
                style={{ background: seatColor(p.seat) }}
                aria-hidden
              >
                {initials(heroLabel(p.hero, p.name))}
              </span>
              <span className="min-w-0 flex-1">
                <span className={p.id === playerId ? "font-semibold" : ""}>{p.name}</span>
                {p.id === playerId && <span className="text-parchment-dim"> (you)</span>}
                {p.id === lobby.hostId && (
                  <span className="ml-2 rounded-sm border border-brass-dim px-1.5 text-xs text-brass">
                    Host
                  </span>
                )}
                <span className="block text-xs text-parchment-dim">
                  {p.connected ? "online" : "offline"}
                </span>
              </span>
              {p.id === playerId ? (
                <label className="text-sm">
                  <span className="sr-only">Your hero</span>
                  <select
                    className="input py-1"
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
                  </select>
                </label>
              ) : (
                <span className="text-sm text-parchment-dim">{heroLabel(p.hero, "No hero")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel flex flex-col gap-3 p-5" aria-labelledby="settings-heading">
        <h2 id="settings-heading" className="font-display text-xl">
          Rules
        </h2>
        <label className="flex items-center justify-between gap-3 text-sm">
          Mode
          <select
            className="input w-auto py-1"
            value={lobby.settings.mode}
            disabled={!isHost}
            onChange={(e) => updateSettings(MODE_PRESETS[e.target.value as LobbySettings["mode"]])}
          >
            <option value="classic">Classic</option>
            <option value="quick">Quick</option>
          </select>
        </label>
        <p className="-mt-1 text-xs text-parchment-dim">{MODE_NOTES[lobby.settings.mode]}</p>
        <label className="flex items-center justify-between gap-3 text-sm">
          Game length
          <select
            className="input w-auto py-1"
            value={limitKey(lobby.settings.limit)}
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
          </select>
        </label>
        {lobby.settings.limit.kind !== "none" && (
          <p className="-mt-1 text-xs text-parchment-dim">
            When the limit is reached the current round finishes, then the richest player wins.
            Paused time does not count.
          </p>
        )}
        <label className="flex items-center justify-between gap-3 text-sm">
          Turn timer
          <select
            className="input w-auto py-1"
            value={lobby.settings.turnTimerSeconds}
            disabled={!isHost}
            onChange={(e) => updateSettings({ turnTimerSeconds: Number(e.target.value) })}
          >
            {TURN_TIMER_OPTIONS.map((sec) => (
              <option key={sec} value={sec}>
                {sec === 0 ? "Off" : `${sec} seconds`}
              </option>
            ))}
          </select>
        </label>
        {lobby.settings.turnTimerSeconds > 0 && (
          <p className="-mt-1 text-xs text-parchment-dim">
            Idle players are auto-played safely: roll, pass, end turn, and raise owed souls. Never
            trades.
          </p>
        )}
        <label className="flex items-center justify-between gap-3 text-sm">
          Starting souls
          <select
            className="input w-auto py-1"
            value={lobby.settings.startingCash}
            disabled={!isHost}
            onChange={(e) => updateSettings({ startingCash: Number(e.target.value) })}
          >
            {STARTING_CASH_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v} {SOULS}
              </option>
            ))}
          </select>
        </label>
        <Toggle
          label="Double salary for landing exactly on the Astral Gate"
          checked={lobby.settings.doubleOnExactGo}
          disabled={!isHost}
          onChange={(doubleOnExactGo) => updateSettings({ doubleOnExactGo })}
        />
        <Toggle
          label="Taxes and fines fill the Soul Urn jackpot"
          checked={lobby.settings.freeParkingJackpot}
          disabled={!isHost}
          onChange={(freeParkingJackpot) => updateSettings({ freeParkingJackpot })}
        />
        <Toggle
          label="Auction properties nobody buys"
          checked={lobby.settings.auctions}
          disabled={!isHost}
          onChange={(auctions) => updateSettings({ auctions })}
        />
        <Toggle
          label="Build evenly, from a limited supply of Guardians and Walkers"
          checked={lobby.settings.evenBuilding}
          disabled={!isHost}
          onChange={(evenBuilding) => updateSettings({ evenBuilding })}
        />
        {!isHost && <p className="text-xs text-parchment-dim">Only the host can change rules.</p>}
      </section>

      {isHost ? (
        <button
          type="button"
          className="btn-primary self-start"
          disabled={lobby.players.length < 2}
          onClick={() => send({ type: "startGame" })}
        >
          {lobby.players.length < 2 ? "Waiting for another player…" : "Begin the ritual"}
        </button>
      ) : (
        <p className="text-sm text-parchment-dim">Waiting for the host to start the game…</p>
      )}
      <ChatPanel lobby={lobby} />
    </div>
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
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <input
        type="checkbox"
        className="size-4 accent-amber"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
