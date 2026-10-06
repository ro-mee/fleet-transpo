"use client";

import { cn } from "@/lib/utils";

const FRAMES = {
  xxs: "h-5 w-5",
  xs: "h-6 w-6",
  sm: "size-7",
  md: "h-8 w-8",
};

// Static Dispatch Copilot identity mark (P2-04/P2-05). The PNG has no frames
// to loop, so repeated bubbles and idle states stay motion-free by
// construction and need no reduced-motion source swap. Repeated instances are
// decorative by default; the single header identity keeps its accessible name
// through `label` — no other caller passes one.
export function CopilotAvatar({ size = "sm", decorative = true, label = null, className = null }) {
  return (
    <span
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 shadow-2xs",
        FRAMES[size] ?? FRAMES.sm,
        className
      )}
      aria-hidden={decorative ? "true" : undefined}
    >
      <img
        src="/images/copilot-avatar.png"
        alt={decorative ? "" : label ?? "Dispatch Copilot"}
        aria-hidden={decorative ? "true" : undefined}
        className="h-full w-full object-cover select-none pointer-events-none"
      />
    </span>
  );
}
