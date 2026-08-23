import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PhaseRail — one visual grammar for every ordered lifecycle
 * (request → reservation → dispatch → trip progress).
 *
 * Props:
 *   steps   [{ key, label }] in execution order.
 *   status  the record's current status string (matched against step.key,
 *           case-insensitive). Unknown / legacy values render the rail with no
 *           active step rather than breaking — callers can pass `fallbackNote`
 *           to explain why.
 *   compact Smaller paddings for dense surfaces.
 */
export function PhaseRail({ steps = [], status, compact = false, className, fallbackNote }) {
  const normalized = String(status || "").toLowerCase();
  const currentIndex = steps.findIndex((s) => s.key.toLowerCase() === normalized);
  const done = currentIndex >= 0;

  return (
    <div className={cn("w-full", className)} role="list" aria-label="Progress">
      <ol className={cn("flex items-start", compact ? "gap-1" : "gap-2")}>
        {steps.map((step, i) => {
          const isComplete = done && i < currentIndex;
          const isCurrent = done && i === currentIndex;
          return (
            <li key={step.key} role="listitem" className="flex-1 min-w-0 flex flex-col items-center text-center relative">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-[11px] right-1/2 w-full h-[2px] -z-0 rounded-full",
                    isComplete || isCurrent ? "bg-success" : "bg-border"
                  )}
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 flex items-center justify-center rounded-full border-2 font-data font-bold",
                  compact ? "h-4 w-4 text-[8px]" : "h-6 w-6 text-[10px]",
                  isCurrent && "border-primary bg-primary text-white shadow-xs",
                  isComplete && "border-success bg-success text-white",
                  !isComplete && !isCurrent && "border-border bg-surface text-foreground-muted"
                )}
              >
                {isComplete ? <Check className={compact ? "h-2 w-2" : "h-3.5 w-3.5"} /> : i + 1}
              </span>
              <span
                className={cn(
                  "mt-1 leading-tight",
                  compact ? "text-[10px]" : "text-[11px]",
                  isCurrent ? "font-semibold text-foreground" : "font-medium text-foreground-muted"
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      {!done && (
        <p className={cn("mt-1 text-[11px] text-foreground-muted", compact && "text-[10px]")}>
          {fallbackNote ||
            (normalized
              ? `Status: ${status}`
              : "Status pending")}
        </p>
      )}
      {done && (
        <p className="sr-only">
          {`Step ${currentIndex + 1} of ${steps.length}: ${steps[currentIndex]?.label ?? ""}`}
        </p>
      )}
    </div>
  );
}
