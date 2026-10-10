export type Theme = "light" | "dark";

const KEY = "bitflow-theme";

/** Stored theme, or light (the default) if nothing valid is stored or storage is unavailable. */
export function loadTheme(): Theme {
  try {
    return window.localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
