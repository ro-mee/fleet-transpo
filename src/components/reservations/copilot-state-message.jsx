"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopilotStateMessage({
  title,
  description,
  role = "alert",
  tone = "danger",
  children,
}) {
  const warning = tone === "warning";

  return (
    <div
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-foreground",
        warning
          ? "border-warning/30 bg-warning/10"
          : "border-danger/30 bg-danger-bg"
      )}
    >
      <AlertCircle
        className={cn(
          "mt-0.5 size-4 shrink-0",
          warning ? "text-warning-700" : "text-danger-700"
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="font-semibold">{title}</p>
          {description && (
            <p className="mt-0.5 text-xs text-foreground-secondary">
              {description}
            </p>
          )}
        </div>
        {children && (
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}
