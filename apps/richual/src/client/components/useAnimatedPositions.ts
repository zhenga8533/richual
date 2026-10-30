import { useEffect, useRef, useState } from "react";

/** Longest a token's hop may take, so animations never slow the game down. */
const MAX_ANIMATION_MS = 600;
const MAX_STEP_MS = 90;
/** Longer jumps are teleports (cards, banishment) and move directly. */
const MAX_WALK = 12;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The position to draw each token at: it walks space by space towards the real
 * position after a forward move, and jumps for anything else. A new target
 * mid-walk cancels the old walk, so animations never lag the real state.
 */
export function useAnimatedPositions(
  targets: Record<string, number>,
  boardSize: number,
): Record<string, number> {
  const [shown, setShown] = useState(targets);
  const shownRef = useRef(targets);
  const key = JSON.stringify(targets);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures every change to targets
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const show = (positions: Record<string, number>) => {
      shownRef.current = positions;
      setShown(positions);
    };

    const start: Record<string, number> = { ...targets };
    const walks: { id: string; from: number; distance: number }[] = [];
    if (!reducedMotion()) {
      for (const [id, target] of Object.entries(targets)) {
        const from = shownRef.current[id];
        if (from === undefined) continue;
        const distance = (target - from + boardSize) % boardSize;
        if (distance === 0 || distance > MAX_WALK) continue;
        start[id] = from;
        walks.push({ id, from, distance });
      }
    }
    show(start);

    for (const { id, from, distance } of walks) {
      const stepMs = Math.min(MAX_STEP_MS, MAX_ANIMATION_MS / distance);
      for (let step = 1; step <= distance; step++) {
        timers.push(
          setTimeout(
            () => show({ ...shownRef.current, [id]: (from + step) % boardSize }),
            step * stepMs,
          ),
        );
      }
    }
    // Cancelling on a new target leaves tokens where they are; the next walk starts from there.
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [key, boardSize]);

  return shown;
}
