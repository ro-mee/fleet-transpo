"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { PanelLeft, PanelLeftClose, MousePointer2 } from "lucide-react";

const STORAGE_KEY = "fleetops-sidebar-behavior";

export const SIDEBAR_MODES = [
  {
    value: "expanded",
    label: "Expanded",
    description: "Full width, labels always shown",
    icon: PanelLeft,
  },
  {
    value: "collapsed",
    label: "Collapsed",
    description: "Icon rail, stays narrow",
    icon: PanelLeftClose,
  },
  {
    value: "auto",
    label: "Auto",
    description: "Icon rail, opens on hover",
    icon: MousePointer2,
  },
];

const MODE_VALUES = SIDEBAR_MODES.map((m) => m.value);
const DEFAULT_MODE = "expanded";

const SidebarContext = createContext();

export function SidebarProvider({ children }) {
  const [mode, setModeState] = useState(DEFAULT_MODE);

  // localStorage doesn't exist during SSR, so the first paint uses the default
  // and the stored preference is promoted right after hydration.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-hydration promote: avoids SSR/client markup mismatch
      if (stored && MODE_VALUES.includes(stored)) setModeState(stored);
    } catch {
      // Blocked storage shouldn't break the shell.
    }
  }, []);

  const setMode = useCallback((next) => {
    if (!MODE_VALUES.includes(next)) return;
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference just won't survive a reload.
    }
  }, []);

  // `collapsed` drives the 72px rail; `peek` is what lets it widen on hover.
  const collapsed = mode !== "expanded";
  const peek = mode === "auto";

  const toggle = useCallback(() => {
    setMode(collapsed ? "expanded" : "collapsed");
  }, [collapsed, setMode]);

  return (
    <SidebarContext.Provider value={{ mode, setMode, toggle, collapsed, peek }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
