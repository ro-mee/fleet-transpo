"use client";

import { useEffect, useState } from "react";
import { DESKTOP_MIN_WIDTH } from "./mechanic-actions";

// Web-only Workshop (≥1024px): below the breakpoint the UI stays fully
// visible but mutating actions disable with the desktop reason. Server-safe:
// unknown viewport counts as desktop so the first paint never disables
// actions that hydration then enables (no flash of disabled buttons).
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
    const onChange = (event) => setIsDesktop(event.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    return undefined;
  }, []);

  return isDesktop;
}
