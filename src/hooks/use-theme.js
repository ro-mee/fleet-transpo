"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";

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

function setModeValue(next, source) {
  if (!MODES.includes(next)) return;
  const currentEffective = effectiveTheme(storedMode());
  const nextEffective = effectiveTheme(next);

  const canAnimate =
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !document.hidden &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const commit = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference just won't survive a reload.
    }
    applyTheme(next);
    listeners.forEach((l) => l());
  };

  if (!canAnimate || currentEffective === nextEffective) {
    commit();
    return;
  }

  const isGoingDark = nextEffective === "dark";

  // Measure the target button synchronously in real-time immediately before starting the transition
  const button =
    (source && typeof source.getBoundingClientRect === "function"
      ? source.closest?.("[data-theme-toggle]") || source
      : null) ||
    document.querySelector("[data-theme-toggle]") ||
    document.querySelector(".theme-toggle-btn");

  const rect = button?.getBoundingClientRect?.();

  // If no element or invalid geometry, fall back to immediate change
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    commit();
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const endRadius = Math.ceil(
    Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y)
    )
  ) + 10;

  const root = document.documentElement;
  root.dataset.themeTransition = isGoingDark ? "expand" : "shrink";

  let transition;
  try {
    transition = document.startViewTransition(() => {
      commit();
    });
  } catch {
    delete root.dataset.themeTransition;
    commit();
    return;
  }

  const pseudoElement = isGoingDark
    ? "::view-transition-new(root)"
    : "::view-transition-old(root)";

  const keyframes = isGoingDark
    ? [
        { clipPath: `circle(0px at ${x}px ${y}px)` },
        { clipPath: `circle(${endRadius}px at ${x}px ${y}px)` },
      ]
    : [
        { clipPath: `circle(${endRadius}px at ${x}px ${y}px)` },
        { clipPath: `circle(0px at ${x}px ${y}px)` },
      ];

  transition.ready
    .then(() => {
      const animation = document.documentElement.animate(keyframes, {
        duration: 450,
        easing: "cubic-bezier(0.25, 1, 0.5, 1)",
        pseudoElement,
        fill: "both",
      });
      return animation.finished.catch(() => {});
    })
    .catch(() => {});

  transition.finished
    .catch(() => {})
    .finally(() => {
      delete root.dataset.themeTransition;
    });
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
  const [mounted, setMounted] = useState(false);

  const toggle = useCallback((source) => {
    const current = effectiveTheme(storedMode());
    setModeValue(current === "dark" ? "light" : "dark", source);
  }, []);

  // Sync the initial class from localStorage (the blocking script handles the
  // class on first paint; this picks up any mode that wasn't applied then).
  useEffect(() => {
    applyTheme(storedMode());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- records that client hydration has completed
    setMounted(true);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode: setModeValue, toggle, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
