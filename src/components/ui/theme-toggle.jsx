"use client";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className, ...props }) {
  const { theme, toggle, mounted } = useTheme();
  const isDark = mounted ? theme === "dark" : false;

  return (
    <button
      type="button"
      onClick={toggle}
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
          "h-4 w-4 transform transition-transform duration-500 ease-out",
          isDark ? "rotate-90 text-amber-400" : "rotate-0 text-foreground-muted"
        )}
      >
        <mask id="theme-toggle-moon-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <circle
            cx={isDark ? "28" : "17"}
            cy={isDark ? "-4" : "7"}
            r="7"
            fill="black"
            className="transition-all duration-500 ease-out"
          />
        </mask>

        {/* Center circle (Sun core or Moon body) */}
        <circle
          cx="12"
          cy="12"
          r={isDark ? "5" : "9"}
          fill="currentColor"
          mask="url(#theme-toggle-moon-mask)"
          className="transition-all duration-500 ease-out"
        />

        {/* Sun Rays (Expand in Dark Mode, Contract in Light Mode) */}
        <g
          stroke="currentColor"
          strokeWidth="2"
          className={cn(
            "transition-all duration-500 ease-out origin-center",
            isDark ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-0 -rotate-45 pointer-events-none"
          )}
        >
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </g>
      </svg>
    </button>
  );
}
