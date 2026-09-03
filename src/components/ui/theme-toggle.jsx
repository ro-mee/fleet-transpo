"use client";

import { useRef } from "react";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className, ...props }) {
  const { theme, toggle, mounted } = useTheme();
  const buttonRef = useRef(null);
  const isDark = mounted ? theme === "dark" : false;

  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={(e) => {
        toggle(buttonRef.current || e?.currentTarget);
      }}
      data-theme-toggle="true"
      className={cn(
        "theme-toggle-btn relative flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-hover transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 select-none active:scale-90",
        className
      )}
      title={mounted ? (isDark ? "Switch to Light mode" : "Switch to Dark mode") : "Toggle theme"}
      aria-label={mounted ? (isDark ? "Switch to Light mode" : "Switch to Dark mode") : "Toggle theme"}
      {...props}
    >
      <span className="sr-only">Toggle theme</span>

      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "h-5 w-5 transform transition-all duration-500",
          isDark ? "rotate-[360deg] text-amber-500" : "rotate-0 text-foreground-muted"
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        <mask id="theme-toggle-moon-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <circle
            cx={isDark ? "28" : "15"}
            cy={isDark ? "-4" : "5"}
            r="8"
            fill="black"
            className="transition-all duration-500"
            style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
          />
        </mask>

        {/* Center circle (Sun core or Moon body) */}
        <circle
          cx="12"
          cy="12"
          r={isDark ? "5" : "9"}
          fill="currentColor"
          mask="url(#theme-toggle-moon-mask)"
          className="transition-all duration-500"
          style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        />

        {/* Sun Rays (Expand in Dark Mode, Contract in Light Mode) */}
        <g
          stroke="currentColor"
          strokeWidth="2"
          className={cn(
            "transition-all duration-500 origin-center",
            isDark ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 -rotate-90 pointer-events-none"
          )}
          style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
          <line x1="12" y1="2" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="22" />
          <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
          <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
          <line x1="2" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="22" y2="12" />
          <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
          <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
        </g>
      </svg>
    </button>
  );
}
