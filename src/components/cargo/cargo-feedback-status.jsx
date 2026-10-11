import React from "react";
import { AlertTriangle, CheckCircle2, Clock3, RotateCcw } from "lucide-react";

export function CargoFeedbackStatus({ feedback, canRetry = false, onRetry, isRetrying = false, retryError = "" }) {
  const state = feedback?.state;
  if (!state) {
    return <p className="text-xs text-foreground-muted">Partner delivery status is unavailable.</p>;
  }

  const status = state === "ACKNOWLEDGED"
    ? { label: "Message received", variant: "success", icon: CheckCircle2 }
    : state === "FAILED"
      ? { label: "Delivery failed", variant: "danger", icon: AlertTriangle }
      : { label: "Waiting to send", variant: "warning", icon: Clock3 };
  const Icon = status.icon;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-foreground-secondary" aria-hidden="true" />
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
            status.variant === "success" ? "bg-success-bg text-success" :
              status.variant === "danger" ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning"
          }`}>{status.label}</span>
        </div>
        <p className="mt-1 text-xs text-foreground-secondary">
          {state === "ACKNOWLEDGED"
            ? "The partner received the message. This does not approve cargo quantities."
            : state === "FAILED"
              ? "The partner message did not arrive. This does not change the cargo decision."
              : "The partner message is still waiting to send. Message delivery is separate from cargo approval."}
        </p>
        {state === "FAILED" && feedback.last_error_code && (
          <p className="mt-1 font-data text-[11px] text-foreground-muted">Delivery code: {feedback.last_error_code}</p>
        )}
        {retryError && <p role="alert" className="mt-1 text-xs text-danger-800 dark:text-rose-200">{retryError}</p>}
      </div>
      {state === "FAILED" && canRetry && onRetry && (
        <button type="button" className="inline-flex h-8 items-center justify-center rounded border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-50" disabled={isRetrying} onClick={onRetry}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {isRetrying ? "Queuing retry…" : "Retry delivery"}
        </button>
      )}
    </div>
  );
}
