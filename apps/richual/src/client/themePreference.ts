import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const KEY = "richual:theme";

function load(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** The viewer's theme choice; "system" follows the OS. Mirrors public/theme-init.js. */
export function useThemePreference(): [ThemePreference, (theme: ThemePreference) => void] {
  const [theme, setTheme] = useState(load);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // Not remembering the choice is fine.
    }
  }, [theme]);

  return [theme, setTheme];
}
