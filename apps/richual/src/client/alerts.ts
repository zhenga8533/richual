import { useEffect, useRef, useState } from "react";

const KEY = "richual:alerts";

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/** Opt-in alerts for when the game needs you while you're in another window. */
export function useAlertPreference(): [boolean, (on: boolean) => void] {
  const [enabled, setEnabled] = useState(loadEnabled);
  const update = (on: boolean) => {
    setEnabled(on);
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      // Not remembering the preference is fine.
    }
    if (on && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  };
  return [enabled, update];
}

/** A short two-note chime, synthesized so no audio asset is needed. */
function chime(): void {
  try {
    const ctx = new AudioContext();
    const notes = [660, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const start = ctx.currentTime + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch (error) {
    console.warn("could not play alert sound", error);
  }
}

/** Fires once each time `needed` turns true while the page is hidden. */
export function useNeedsYouAlert(needed: boolean, enabled: boolean, message: string): void {
  const previous = useRef(needed);
  useEffect(() => {
    const becameNeeded = needed && !previous.current;
    previous.current = needed;
    if (!becameNeeded || !enabled || !document.hidden) return;
    chime();
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification("Richual", { body: message, tag: "richual-turn" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  }, [needed, enabled, message]);
}
