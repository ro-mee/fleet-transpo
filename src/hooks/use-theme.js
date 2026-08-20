"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

// Theme store with three explicit modes: light, dark, system.
//
// The store resolves `system` against the OS `prefers-color-scheme` media query
// at read time, so consumers always see an *effective* theme ("dark"|"light")
// in `theme` — that keeps every existing `theme === "dark"` check working —
// while `mode` holds what the user actually picked ("light"|"dark"|"system")
// and drives the selector UI on /settings/general.
//
// The layout blocking script (src/app/layout.js) must agree on the storage key
// and on how `system` resolves, or the page flashes the wrong theme before
// hydration. Keep both in sync.

const MODES = ["light", "dark", "system"];
const STORAGE_KEY = "fleetops-theme";

const ThemeContext = createContext();

let listeners = [];
function subscribe(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function storedMode() {
  try {
    const s = window.localStorage.getItem(STORAGE_KEY);
    return MODES.includes(s) ? s : "light";
  } catch {
    return "light";
  }
}

function osDark() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function effectiveTheme(mode) {
  return mode === "system" ? (osDark() ? "dark" : "light") : mode;
}

function applyTheme(mode) {
  document.documentElement.classList.toggle("dark", effectiveTheme(mode) === "dark");
}

// Cache the snapshot object so useSyncExternalStore sees a stable reference
// between actual changes (Object.is comparison would otherwise loop forever).
let cache = null;
function getSnapshot() {
  const mode = storedMode();
  const next = { mode, theme: effectiveTheme(mode) };
  if (!cache || cache.mode !== next.mode || cache.theme !== next.theme) cache = next;
  return cache;
}

const SERVER_SNAPSHOT = { mode: "light", theme: "light" };
function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

function setModeValue(next) {
  if (!MODES.includes(next)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Preference just won't survive a reload.
  }
  applyTheme(next);
  listeners.forEach((l) => l());
}

// Re-resolve `system` when the OS preference flips. Snapshot caching keeps
// this a no-op for consumers pinned to light/dark.
if (typeof window !== "undefined" && window.matchMedia) {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => listeners.forEach((l) => l()));
}

export function ThemeProvider({ children }) {
  const { theme, mode } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    setModeValue(effectiveTheme(storedMode()) === "dark" ? "light" : "dark");
  }, []);

  // Sync the initial class from localStorage (the blocking script handles the
  // class on first paint; this picks up any mode that wasn't applied then).
  useEffect(() => {
    applyTheme(storedMode());
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode: setModeValue, toggle, mounted: true }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}