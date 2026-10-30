import { initials, seatColor } from "../theme";
import { cn } from "../ui/cn";
import { heroLabel } from "./heroLabel";

/** A player's seat colour with their hero's initials; the same everywhere a player appears. */
export function PlayerAvatar({
  seat,
  hero,
  name,
  online,
  className,
}: {
  seat: number;
  hero: string | null;
  name: string;
  /** Shows a presence dot when defined. */
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-grid size-8 shrink-0", className)} aria-hidden>
      <span
        className="grid size-full place-items-center rounded-full text-[0.7rem] font-semibold text-ink ring-1 ring-black/25"
        style={{ background: seatColor(seat) }}
      >
        {initials(heroLabel(hero, name))}
      </span>
      {online !== undefined && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface",
            online ? "bg-emerald-500" : "bg-muted",
          )}
        />
      )}
    </span>
  );
}
