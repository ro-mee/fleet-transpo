import React from "react";
const ACTION_LABELS = {
  WAIT: "Waiting for another count or source review",
  ACCEPT_OBSERVED: "Source accepted the observed pickup count",
  REJECT_PICKUP: "Source rejected this pickup",
};

const HISTORY_LABELS = {
  PICKUP_RECORDED: "Pickup count recorded",
  DELIVERY_RECORDED: "Delivery count recorded",
  SOURCE_DECISION_RECORDED: "Source decision recorded",
  FLEET_CLEARANCE_RECORDED: "Fleet clearance recorded",
  PARTNER_FEEDBACK: "Partner message delivery updated",
};

function readableTime(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "Time not recorded";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function StatusRow({ label, children, tone = "secondary" }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 py-2.5 last:border-0 last:pb-0">
      <span className="text-xs font-medium text-foreground-secondary">{label}</span>
      <span className="max-w-[70%] text-right text-xs font-semibold text-foreground break-words">{children || <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground-secondary">Not recorded</span>}</span>
    </div>
  );
}

export function CargoDecisionHistory({ view }) {
  const decision = view?.source_decision;
  const clearance = view?.fleet_clearance;
  const receiverConfirmed = view?.receiver_confirmed === true || view?.delivery_receipt?.receiver_confirmed === true;
  const history = Array.isArray(view?.history?.rows) ? view.history.rows : [];

  return (
    <section className="rounded-lg border border-border bg-surface shadow-none" aria-labelledby="cargo-decision-history-title">
      <header className="border-b border-border/60 px-4 py-3">
        <h3 id="cargo-decision-history-title" className="text-sm font-semibold text-foreground">Decision and custody history</h3>
      </header>
      <div className="px-4 py-3">
        <div className="grid gap-x-8 md:grid-cols-3">
          <StatusRow label="Source decision">
            {decision ? ACTION_LABELS[decision.action] || "Decision recorded" : null}
          </StatusRow>
          <StatusRow label="Fleet clearance">
            {clearance ? (clearance.securement_confirmed === true ? "Clearance and load securement confirmed" : "Clearance recorded; securement status unavailable") : null}
          </StatusRow>
          <StatusRow label="Receiver confirmation">
            {view?.delivery_receipt ? (receiverConfirmed ? "Confirmed" : "Not confirmed") : null}
          </StatusRow>
        </div>

        <div className="mt-4 border-t border-border/60 pt-3">
          <h4 className="text-xs font-semibold text-foreground">Activity timeline</h4>
          {history.length ? (
            <ol className="mt-2 space-y-2">
              {history.map((event, index) => {
                const label = HISTORY_LABELS[event.event_type] || (event.stage === "PICKUP" ? "Pickup count recorded" :
                  event.stage === "DELIVERY" ? "Delivery count recorded" : "Cargo record updated");
                return (
                  <li key={event.event_id || `${event.event_type}-${event.execution_version}-${index}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-md bg-muted/20 px-3 py-2">
                    <span className="min-w-0 text-xs text-foreground break-words">
                      {event.action ? ACTION_LABELS[event.action] || "Source decision recorded" : label}
                      {event.status && <span className="text-foreground-secondary"> · {String(event.status).toLowerCase().replaceAll("_", " ")}</span>}
                    </span>
                    <time className="shrink-0 text-[11px] text-foreground-muted">{readableTime(event.occurred_at)}</time>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-2 text-xs text-foreground-muted">No cargo activity is available yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
