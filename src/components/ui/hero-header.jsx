"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/hooks/use-theme";

export const heroButtonOutlineClass =
  "border-white/30 bg-white/10 text-white shadow-none hover:border-white/45 hover:bg-white/20 focus-visible:ring-white dark:border-slate-900/25 dark:bg-slate-900/5 dark:text-slate-900 dark:hover:border-slate-900/40 dark:hover:bg-slate-900/10 dark:focus-visible:ring-slate-900 transition-[background-color,border-color,transform] active:scale-[0.98]";

export const heroButtonPrimaryClass =
  "border border-white/80 bg-white text-slate-950 shadow-xs hover:-translate-y-px hover:bg-white/90 focus-visible:ring-white dark:border-slate-900 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus-visible:ring-slate-900 font-bold transition-[background-color,border-color,transform] active:translate-y-0 active:scale-[0.98]";

export function HeroHeader({
  icon: Icon,
  title,
  badge,
  description,
  actions,
  children,
  className,
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div
      className={cn(
        "relative overflow-hidden flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 p-5 sm:px-6 rounded-3xl shadow-sm transition-colors duration-200",
        // Invert theme:
        // Light Mode (isDark === false) -> Dark Background (#141414) with White Text
        // Dark Mode  (isDark === true)  -> Pure White Background (#ffffff) with Dark Slate Text (#0f172a)
        isDark
          ? "bg-white text-slate-900 border border-black/10"
          : "bg-[#141414] text-white border border-white/10",
        className
      )}
    >
      {/* Decorative background ambient glows & geometric curves */}
      <div
        className={cn(
          "pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full border transition-colors",
          isDark ? "border-black/10" : "border-white/10"
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute right-10 top-6 h-28 w-28 rounded-full blur-xl transition-colors",
          isDark ? "bg-black/[0.03]" : "bg-white/[0.05]"
        )}
      />

      <div className="relative flex items-center gap-4 z-10">
        {Icon && (
          <div
            className={cn(
              "p-3.5 rounded-2xl shrink-0 border transition-colors",
              isDark
                ? "bg-black/5 text-slate-900 border-black/15"
                : "bg-white/10 text-white border-white/15"
            )}
          >
            <Icon className="w-6 h-6" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1
              className={cn(
                "text-2xl font-bold tracking-tight transition-colors",
                isDark ? "text-slate-900" : "text-white"
              )}
            >
              {title}
            </h1>
            {badge && (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 px-3 py-1 text-xs rounded-full font-bold border transition-colors",
                  isDark
                    ? "bg-black/5 text-slate-900 border-black/20"
                    : "bg-white/10 text-white border-white/20"
                )}
              >
                {badge}
              </Badge>
            )}
          </div>
          {description && (
            <p
              className={cn(
                "text-xs mt-1 transition-colors",
                isDark ? "text-slate-600" : "text-white/70"
              )}
            >
              {description}
            </p>
          )}
          {children}
        </div>
      </div>

      {actions && (
        <div className="relative flex flex-wrap items-center gap-3 shrink-0 z-10">
          {actions}
        </div>
      )}
    </div>
  );
}
