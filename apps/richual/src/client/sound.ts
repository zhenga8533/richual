import { create } from "zustand";

/**
 * Small synthesized sound effects. Everything is generated with Web Audio, so
 * there are no audio files to load and nothing for the CSP to allow.
 */
export type SoundName =
  | "dice"
  | "coinUp"
  | "coinDown"
  | "buy"
  | "card"
  | "bid"
  | "yourMove"
  | "bankrupt"
  | "win";

const KEY = "richual:sound";
const DEFAULT_VOLUME = 0.3;

type SoundSettings = { volume: number; muted: boolean };

function load(): SoundSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SoundSettings> | null;
    return {
      volume:
        typeof raw?.volume === "number" ? Math.min(1, Math.max(0, raw.volume)) : DEFAULT_VOLUME,
      muted: raw?.muted === true,
    };
  } catch {
    return { volume: DEFAULT_VOLUME, muted: false };
  }
}

export const useSoundSettings = create<SoundSettings>(load);

useSoundSettings.subscribe((settings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembering the setting is fine.
  }
});

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/**
 * Browsers only allow audio after a user gesture, so the context is created on
 * the first click or key press. Sounds before that are silently skipped.
 */
function unlock(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  } catch (error) {
    console.warn("audio unavailable", error);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

function tone(
  freq: number,
  start: number,
  duration: number,
  {
    type = "sine",
    gain = 0.5,
    endFreq,
  }: { type?: OscillatorType; gain?: number; endFreq?: number } = {},
): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const t = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(start: number, duration: number, { gain = 0.4, freq = 2000, q = 1 } = {}): void {
  if (!ctx || !master) return;
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  const t = ctx.currentTime + start;
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  env.gain.value = gain;
  source.connect(filter).connect(env).connect(master);
  source.start(t);
}

const SOUNDS: Record<SoundName, () => void> = {
  dice: () => {
    for (let i = 0; i < 5; i++)
      noise(i * 0.055 + Math.random() * 0.02, 0.045, { freq: 2600, q: 3 });
  },
  coinUp: () => {
    tone(988, 0, 0.12, { type: "triangle", gain: 0.35 });
    tone(1319, 0.08, 0.22, { type: "triangle", gain: 0.35 });
  },
  coinDown: () => {
    tone(659, 0, 0.12, { type: "triangle", gain: 0.3 });
    tone(494, 0.08, 0.22, { type: "triangle", gain: 0.3 });
  },
  buy: () => {
    tone(140, 0, 0.18, { gain: 0.7, endFreq: 70 });
    noise(0, 0.05, { freq: 1200, gain: 0.3 });
    tone(784, 0.06, 0.25, { type: "triangle", gain: 0.2 });
  },
  card: () => noise(0, 0.22, { freq: 3500, q: 0.7, gain: 0.25 }),
  bid: () => tone(1200, 0, 0.05, { type: "square", gain: 0.12 }),
  yourMove: () => {
    tone(660, 0, 0.3, { gain: 0.3 });
    tone(880, 0.14, 0.4, { gain: 0.3 });
  },
  bankrupt: () => {
    tone(110, 0, 1.4, { gain: 0.5 });
    tone(165, 0, 1.2, { gain: 0.25 });
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => {
      tone(f, i * 0.11, 0.5, { type: "triangle", gain: 0.3 });
    });
  },
};

export function playSound(name: SoundName): void {
  const { volume, muted } = useSoundSettings.getState();
  if (muted || volume <= 0 || !ctx || !master) return;
  if (ctx.state === "suspended") return;
  master.gain.value = volume;
  try {
    SOUNDS[name]();
  } catch (error) {
    console.warn("could not play sound", name, error);
  }
}
