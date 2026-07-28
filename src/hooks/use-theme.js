"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

const ThemeContext = createContext();

// External store for theme — avoids setState-in-effect issues
let listeners = [];
function subscribe(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function getThemeSnapshot() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot() {
  return "light";
}

function setThemeValue(next) {
  const root = document.documentElement;
  root.classList.toggle("dark", next === "dark");
  localStorage.setItem("fleetops-theme", next);
  listeners.forEach((l) => l());
}

export function ThemeProvider({ children }) {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    setThemeValue(getThemeSnapshot() === "dark" ? "light" : "dark");
  }, []);

  // Sync initial theme from localStorage on mount (the blocking script handles
  // the class, but this ensures the store picks it up)
  useEffect(() => {
    const stored = localStorage.getItem("fleetops-theme");
    if (stored === "dark" && !document.documentElement.classList.contains("dark")) {
      setThemeValue("dark");
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle, mounted: true }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
