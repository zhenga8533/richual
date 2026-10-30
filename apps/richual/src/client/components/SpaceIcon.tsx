import type { Space } from "@richual/engine";

/**
 * Original line icons for the non-property spaces, drawn in currentColor so
 * they follow the theme. Decorative: the space name is always in the label.
 */
export function SpaceIcon({ space, className = "" }: { space: Space; className?: string }) {
  const path = iconPath(space);
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {path}
    </svg>
  );
}

function iconPath(space: Space) {
  switch (space.kind) {
    case "go":
      // A portal: concentric rings with a forward arrow.
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <path d="M9 12h6m-2-2 2 2-2 2" />
        </>
      );
    case "jail":
      // A keyhole.
      return (
        <>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <circle cx="12" cy="10" r="2.5" />
          <path d="M11 12.5 10 17h4l-1-4.5" />
        </>
      );
    case "freeParking":
      // An urn.
      return (
        <>
          <path d="M8 4h8M9 4c0 2-3 3-3 7a6 6 0 0 0 12 0c0-4-3-5-3-7" />
          <path d="M9 20h6M12 17v3" />
        </>
      );
    case "goToJail":
      // A watching eye.
      return (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case "card":
      return space.deck === "oracle" ? (
        // A folded newspaper.
        <>
          <path d="M4 5h13v14H6a2 2 0 0 1-2-2V5Z" />
          <path d="M17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 12h7M7 15h4" />
        </>
      ) : (
        // A ritual candle.
        <>
          <path d="M9 10h6v10H9z" />
          <path d="M12 3c1.5 2 1.5 3.5 0 5-1.5-1.5-1.5-3 0-5Z" />
          <path d="M7 20h10" />
        </>
      );
    case "zipline":
      // A cable with a trolley.
      return (
        <>
          <path d="M3 6 21 10" />
          <path d="M11 8v4M8 12h6l-1 5h-4z" />
        </>
      );
    case "utility":
      return space.name.includes("Water") ? (
        <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" />
      ) : (
        <path d="M13 2 5 14h6l-1 8 8-12h-6z" />
      );
    case "tax":
      // A coin with the soul glyph.
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7 16 12 12 17 8 12z" />
        </>
      );
    case "property":
      return null;
  }
}
