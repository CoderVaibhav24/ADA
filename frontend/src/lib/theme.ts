import { useCallback, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "icms.theme";
const listeners = new Set<() => void>();

function read(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

let snapshot: Theme = read();

function emit() {
  snapshot = read();
  for (const l of listeners) l();
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
  }
  emit();
}

export function initTheme() {
  if (typeof document === "undefined") return;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
  }
  if (stored === "light" || stored === "dark") {
    setTheme(stored);
    return;
  }
  setTheme(
    window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark",
  );
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => "dark" as Theme,
  );
  const toggle = useCallback(() => {
    setTheme(read() === "light" ? "dark" : "light");
  }, []);
  return { theme, setTheme, toggleTheme: toggle };
}
