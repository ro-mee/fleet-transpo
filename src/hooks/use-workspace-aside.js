"use client";

import { useEffect, useState } from "react";

// Minimum usable content width for the side-by-side queue workspace:
// 460px Copilot aside + 24px gutter + at least 636px of queue column.
// Anything narrower opens the same Copilot body in the drawer instead of
// crushing the queue beside the navigation.
export const WORKSPACE_ASIDE_MIN_WIDTH = 1120;

export function meetsAsideThreshold(contentWidth) {
  return (
    typeof contentWidth === "number" &&
    Number.isFinite(contentWidth) &&
    contentWidth >= WORKSPACE_ASIDE_MIN_WIDTH
  );
}

// True only when the observed workspace *content* width clears the threshold.
// The first render (and every SSR pass) reports false: measuring happens in
// an effect after mount, so the server markup and the first client paint agree
// and hydration never mismatches. Callers must freeze a busy operation's
// presentation (see DispatchPlanPanel) so crossing the threshold mid-commit
// cannot unmount the in-flight decision body.
export function useWorkspaceAside(hostRef) {
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    const host = hostRef?.current;
    if (!host || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => setIsWide(meetsAsideThreshold(host.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef]);
  return isWide;
}
