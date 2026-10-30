import { useEffect, useState } from "react";
import { serverNow } from "../connection";

/** Re-renders on an interval with the current server time. */
export function useServerNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Seconds left on a decision before it is auto-played. */
export function Countdown({ deadline }: { deadline: number }) {
  const now = useServerNow();
  const left = Math.max(0, deadline - now);
  const urgent = left < 10_000;
  return (
    <span
      className={`tabular-nums text-sm ${urgent ? "text-blood" : "text-parchment-dim"}`}
      title="Auto-played when this runs out"
    >
      ⏳ {Math.ceil(left / 1000)}s
    </span>
  );
}
