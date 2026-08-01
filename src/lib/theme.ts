// Theme preference: what the person chose, versus what is actually on screen.
//
// "system" follows the OS and re-resolves when it flips. "light" and "dark" pin
// it. The choice lives in localStorage rather than the database because it is a
// per-device preference: the same person on a bright office monitor and a laptop
// at night wants different answers.

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "cd-theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemeChoice(): ThemeChoice {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeChoice(stored) ? stored : "system";
}

export function systemTheme(): ResolvedTheme {
  if (typeof matchMedia === "undefined") return "light";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === "system" ? systemTheme() : choice;
}

// Stamp the resolved theme on <html>. globals.css keys off this attribute only,
// so there is no media query to keep in sync.
export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Private browsing or a full quota. The theme still applies for this page.
  }
}

/**
 * The script that runs before first paint.
 *
 * Inlined into <head> so the attribute is set before the browser paints,
 * otherwise a dark-mode user gets a white flash on every navigation. It is
 * deliberately tiny and dependency-free, wrapped in try/catch because a
 * localStorage throw here would block the whole page from rendering.
 */
export const THEME_BOOT_SCRIPT = `
(function(){try{
var k=localStorage.getItem("${THEME_STORAGE_KEY}");
var t=(k==="light"||k==="dark")?k:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
document.documentElement.setAttribute("data-theme",t);
}catch(e){document.documentElement.setAttribute("data-theme","light");}})();
`.trim();
