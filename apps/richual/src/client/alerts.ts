import { useEffect, useRef, useState } from "react";
import { playSound } from "./sound";

const KEY = "richual:alerts";

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/** Opt-in desktop notifications for when the game needs you while you're in another window. */
export function useNotificationPreference(): [boolean, (on: boolean) => void] {
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

/**
 * Fires once each time `needed` turns true: a chime (subject to the sound
 * settings) and, if enabled and the page is hidden, a desktop notification.
 */
export function useNeedsYouAlert(needed: boolean, notify: boolean, message: string): void {
  const previous = useRef(needed);
  useEffect(() => {
    const becameNeeded = needed && !previous.current;
    previous.current = needed;
    if (!becameNeeded) return;
    playSound("yourMove");
    if (notify && document.hidden && "Notification" in window) {
      if (Notification.permission !== "granted") return;
      const n = new Notification("Richual", { body: message, tag: "richual-turn" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  }, [needed, notify, message]);
}
