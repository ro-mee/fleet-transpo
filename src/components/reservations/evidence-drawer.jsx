"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { formatDateTime, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CopilotStateMessage } from "@/components/reservations/copilot-state-message";

// Read-only evidence drawer (Phase B2). Displays server-verified proof for one
// signed evidence reference. GET-only: one request on open; a second request
// occurs only after explicit Retry (planStatus changes never refetch). Never
// validates, polls, reranks, selects, assigns, or mutates.
// Staleness is observed from the existing plan-validation state owned by the
// panel, never determined here.
export async function fetchEvidence(requestId, proofRef) {
  const data = await apiFetch(
    `/api/integration/transport-requests/${requestId}/evidence?ref=${encodeURIComponent(proofRef)}`,
    { method: "GET" }
  );
  return data;
}

const ROW_LABELS = {
  driverName: "Driver", plate: "Vehicle", status: "Status", startDate: "Leave from", endDate: "Leave until",
  overlapsBooking: "Overlaps booking", evaluatedWindow: "Evaluated window", maintenanceId: "Record",
  type: "Type", maintenanceDate: "Service date", availability: "Vehicle availability",
  incidentId: "Incident", severity: "Severity", incidentDate: "Incident date",
  existingDispatchNumber: "Existing assignment", existingDeparture: "Existing start", existingArrival: "Existing end",
  expectedRelease: "Expected release", requestedPickup: "Requested pickup", requestedEnd: "Expected completion",
  subject: "Subject", subjectName: "Name", field: "Document", expiry: "Expiry", bookingDate: "Booking date",
  requestedSeats: "Requested seats", passengerCount: "Passengers", recordedSeats: "Recorded seats", result: "Result",
  pairingState: "Pairing", effectiveDate: "Effective date", finding: "Recorded finding",
  health: "GPS health", observedAt: "Last update", horizon: "Evaluation horizon",
  etaMinutes: "Pickup ETA", etaValid: "ETA status", verdict: "Result", items: "Items",
};

function formatValue(key, value) {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "verdict") return value === "blocked" ? "Blocking" : value === "clear" ? "Clear" : String(value);
  if (key === "etaMinutes") return `${value} min`;
  if (key === "etaValid") return value ? "Valid" : "Not valid";
  if (/date|pickup|arrival|departure|release|end|at$/i.test(key) && typeof value === "string" && Number.isFinite(Date.parse(value))) {
    try { return formatDateTime(value); } catch { return value; }
  }
  if (key === "evaluatedWindow" && typeof value === "object") {
    return `${value.pickupAt ? formatDateTime(value.pickupAt) : "?"} → ${value.endAt ? formatDateTime(value.endAt) : "?"}`;
  }
  if (key === "items" && Array.isArray(value)) {
    return value.map(i => `${i.field}: ${i.expiry ?? "?"} (${i.status})`).join("; ");
  }
  return String(value);
}

function ConflictTimeline({ facts }) {  if (!facts.existingDeparture || !facts.requestedPickup) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs" aria-label="Schedule conflict timeline">
      <p>Existing: {formatValue("existingDeparture", facts.existingDeparture)} → {formatValue("existingArrival", facts.existingArrival)}</p>
      <p>Requested: {formatValue("requestedPickup", facts.requestedPickup)} → {formatValue("requestedEnd", facts.requestedEnd)}</p>
      <p className="mt-1 font-semibold text-danger-700">CONFLICT — windows overlap</p>
    </div>
  );
}

export function EvidenceBody({ data, proofType, planStatus = null }) {
  if (proofType === "comparison") return <ComparisonCard data={data} planStatus={planStatus} />;  const facts = data?.facts ?? {};
  const rows = Object.entries(facts).filter(([, v]) => v !== undefined);
  const stale = !!planStatus?.isInvalid;
  return (
    <>
      {proofType === "schedule_conflict" && <ConflictTimeline facts={facts} />}
      <dl className="space-y-1.5">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs">
            <dt className="shrink-0 text-foreground-secondary">{ROW_LABELS[key] ?? key}</dt>
            <dd className="text-right font-medium text-foreground break-words">{formatValue(key, value)}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] text-foreground-secondary">
        <p>Source: {data.sourceModule ?? data.managingModule ?? "Dispatch evidence"}</p>
        <p>This record is managed by {data.managingModule ?? "Fleet Management"} and is read-only here.</p>
        {data.checkedAt && <p>Checked {formatDateTime(data.checkedAt)}</p>}
      </div>
      {stale && (
        <p role="alert" className="rounded-lg border border-warning/50 bg-warning/10 px-2.5 py-2 text-xs text-foreground">
          Conditions have changed since this evidence was checked. Close this view and use Recheck reservation in the panel for the latest state.
        </p>
      )}
    </>
  );
}

export function EvidenceFailureMessage({ error, onRetry, onClose }) {
  return (
    <CopilotStateMessage
      title="Evidence unavailable"
      description={`This evidence snapshot could not be loaded${error?.message ? `: ${error.message}` : ""}. Retry the snapshot or close this view.`}
    >
      <Button size="sm" variant="outline" onClick={onRetry} className="min-h-[44px]">Retry evidence</Button>
      <Button size="sm" variant="ghost" onClick={onClose} className="min-h-[44px]">Close evidence</Button>
    </CopilotStateMessage>
  );
}

export function EvidenceDrawer({
  requestId,
  proof,
  inspector = null,
  backTo = null,
  planStatus = null,
  openerRef = null,
  closeFocusRef = openerRef,
  nested = false,
  onClose,
  onCloseAll,
  onBack,
  onReviewProof,
}) {
  const proofRef = proof?.ref ?? null;
  const proofType = proof?.type ?? null;
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const closeButtonRef = useRef(null);
  const retry = () => {
    setState({ status: "loading", data: null, error: null });
    setAttempt(value => value + 1);
  };

  useEffect(() => {
    if (!proofRef || !requestId) return;
    let cancelled = false;
    fetchEvidence(requestId, proofRef).then(
      data => { if (!cancelled) setState({ status: "ready", data, error: null }); },
      error => { if (!cancelled) setState({ status: "error", data: null, error }); }
    );
    return () => { cancelled = true; };
    // Retry is explicit; planStatus stays excluded so validation changes never refetch.
  }, [proofRef, requestId, attempt]);

  const headerTitle = inspector ? "Eligibility Evidence" : (state.data?.title ?? "Evidence");
  const handleOpenAutoFocus = event => {
    event.preventDefault();
    closeButtonRef.current?.focus();
  };
  const handleCloseAutoFocus = event => {
    event.preventDefault();
    closeFocusRef?.current?.focus();
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose?.()}>
      <DialogContent
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        overlayClassName={nested ? "z-[80] bg-black/40 backdrop-blur-none" : "z-[60] bg-black/40 backdrop-blur-none"}
        className={cn("left-auto right-0 top-0 translate-x-0 translate-y-0 flex h-dvh max-h-dvh w-full max-w-sm min-w-0 flex-col overflow-hidden rounded-none border-l border-border bg-surface p-0 shadow-xl", nested ? "z-[90]" : "z-[70]")}
      >
        <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
          <div>
            <DialogTitle className="text-sm font-semibold text-foreground">{headerTitle}</DialogTitle>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-foreground-secondary">Read-only evidence</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onCloseAll ?? onClose}
            aria-label="Close evidence"
            className="rounded-lg border border-border px-2.5 min-h-[44px] inline-flex items-center text-xs text-foreground-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {inspector ? (
            <EligibilityInspector
              pairLabel={inspector.pairLabel}
              horizon={inspector.horizon}
              rows={inspector.rows}
              onReviewProof={onReviewProof}
            />
          ) : (
            <>
              {state.status === "loading" && <p role="status" className="text-sm text-foreground-secondary">Loading verified evidence…</p>}
              {state.status === "error" && (
                <EvidenceFailureMessage error={state.error} onRetry={retry} onClose={onClose} />
              )}
              {state.status === "ready" && <EvidenceBody data={state.data} proofType={proofType} planStatus={planStatus} />}
              {backTo && (
                <button
                  type="button"
                  onClick={onBack}
                  className="rounded-lg border border-border px-2.5 min-h-[44px] inline-flex items-center text-xs text-foreground-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
                >
                  Back to checklist
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Option comparison from live server evaluation (B4). Codes, bands and
// facts only — scores are never exposed and never rendered.
export function ComparisonCard({ data, planStatus = null }) {
  const facts = data?.facts ?? {};
  const { optionA, optionB, hierarchy = [] } = facts;
  // Immutable pair identity from the signed server facts (P2-06). The
  // comparison resolver carries vehicleId/driverId only — plates and names
  // are never guessed here. Missing values stay unknown.
  const pairIdentity = side => {
    if (!side || (side.vehicleId == null && side.driverId == null)) return "Unidentified pair";
    return `Vehicle #${side.vehicleId ?? "?"} / Driver #${side.driverId ?? "?"}`;
  };
  const cell = side => {
    if (!side) return "—";
    return (
      <div className="space-y-0.5">
        <p>Reliability: {side.reliability ?? "Unknown"}</p>
        <p>Transfer: {side.transferMinutes != null ? `${side.transferMinutes} min` : "—"}</p>
        <p>Workload: {side.workload?.totalTrips != null ? `${side.workload.totalTrips} trips${side.workload.serviceDate ? ` on ${side.workload.serviceDate}` : ""}` : "—"}</p>
        <p>Standing: {side.standing ?? "—"}</p>
      </div>
    );
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-border/60 px-2.5 py-1.5">
          <h4 className="mb-1 text-sm font-bold text-foreground">{pairIdentity(optionA)}</h4>
          <p className="mb-1 text-[11px] text-foreground-secondary">Option 1</p>
          {cell(optionA)}
        </div>
        <div className="rounded-lg border border-border/60 px-2.5 py-1.5">
          <h4 className="mb-1 text-sm font-bold text-foreground">{pairIdentity(optionB)}</h4>
          <p className="mb-1 text-[11px] text-foreground-secondary">Option 2</p>
          {cell(optionB)}
        </div>
      </div>
      {hierarchy.length > 0 && (
        <div className="rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] text-foreground-secondary">
          <p className="font-medium text-foreground">Current recommendation order</p>
          <p>{hierarchy.join(" → ")}</p>
        </div>
      )}
      <div className="rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] text-foreground-secondary">
        <p>Source: {data.sourceModule ?? data.managingModule ?? "Dispatch evidence"}</p>
        <p>This record is managed by {data.managingModule ?? "Fleet Management"} and is read-only here.</p>
        {data.checkedAt && <p>Checked {formatDateTime(data.checkedAt)}</p>}
      </div>
      {!!planStatus?.isInvalid && (
        <p role="alert" className="rounded-lg border border-warning/50 bg-warning/10 px-2.5 py-2 text-xs text-foreground">
          Conditions have changed since this evidence was checked. Close this view and use Recheck reservation in the panel for the latest state.
        </p>
      )}
    </>
  );
}
// rows render from conversation evidence; each row's Review button fetches
// that row's proof on explicit tap only. Copy is locked: bounded findings,
// never absolute guarantees.
export function buildInspectorRows(clearance = [], meta = {}) {
  const rows = [];
  for (const c of clearance) {
    if (c.status === "verified") {
      rows.push({
        label: c.label, state: "clear",
        note: c.checkId === "leave" ? "No overlap found" : "No blocking issue found",
        proof: c.proof ?? null,
      });
    } else if (c.status === "blocking") {
      // Blocked clearance carries no direct proof ref by contract
      // (evidence-contract mints refs for verified checks; blocking detail
      // rides with recoveryActions in the conversation). The note must not
      // promise an inspector Review button that does not exist.
      rows.push({ label: c.label, state: "blocked", note: "Blocked — see Review Evidence in the conversation for the exclusion detail", proof: null });
    } else {
      rows.push({ label: c.label, state: "verify", note: "Needs verification", proof: null });
    }
  }
  const horizon = meta.horizon ?? null;
  // Live location is inapplicable for two independent reasons, and each must be
  // read from its own field: the timing band (a future evaluation has no
  // present-tense GPS), and the dispatch MODE (a REPOSITION run starts from a
  // preceding commitment's destination, never from live position). REPOSITION is
  // a mode, not a horizon — testing it as a horizon left this branch unreachable
  // and rendered the deliberate exclusion as "GPS Health: Unknown".
  const liveInapplicable = horizon === "FUTURE" || horizon === "SAME_DAY" || meta.mode === "REPOSITION";
  if (liveInapplicable) {
    rows.push({ label: "Current GPS", state: "na", note: "Not applicable", proof: null, horizon });
  } else if (meta.gpsHealth) {
    rows.push({ label: "GPS Health", state: "clear", note: meta.gpsHealth, proof: null, horizon });
  } else {
    rows.push({ label: "GPS Health", state: "verify", note: "Unknown", proof: null, horizon });
  }
  return rows;
}

export function inspectorConclusion(rows = []) {
  if (rows.some(row => row.state === "blocked")) {
    return "Blocking evidence was found in the evaluated server evidence for this booking.";
  }
  const hasClearEligibilityFinding = rows.some(row =>
    row.state === "clear" && !["Current GPS", "GPS Health"].includes(row.label)
  );
  const allFindingsEvaluated = rows.length > 0 && rows.every(row => ["clear", "na"].includes(row.state));
  if (!allFindingsEvaluated || !hasClearEligibilityFinding) {
    return "Eligibility is unknown because the evaluated server evidence for this booking is missing or needs verification.";
  }
  return "Eligible based only on the evaluated server evidence for this booking.";
}

export function EligibilityInspector({ pairLabel, horizon, rows, onReviewProof }) {
  return (
    <div className="space-y-2">
      {pairLabel && <h4 className="text-sm font-bold text-foreground">{pairLabel}</h4>}
      <dl className="space-y-1.5">
        {rows.map((row, idx) => (
          <div key={`${row.label}-${idx}`} className="rounded-lg border border-border/60 px-2.5 py-1.5 text-xs">
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-foreground-secondary">{row.label}</dt>
              <dd className="text-right font-medium text-foreground">{row.state === "clear" ? `✓ ${row.note}` : row.state === "na" ? "— Not applicable" : row.note}</dd>
            </div>
            {row.proof?.ref && (
              <button
                type="button"
                onClick={event => onReviewProof?.(row.proof, event.currentTarget)}
                className="mt-1.5 rounded-lg border border-border px-2.5 min-h-[44px] inline-flex items-center text-xs text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
              >
                Review
              </button>
            )}
          </div>
        ))}
      </dl>
      {horizon && (
        <p className="text-[11px] text-foreground-secondary">Evaluation horizon: {horizon}</p>
      )}
      <p className="text-[11px] text-foreground-secondary">{inspectorConclusion(rows)}</p>
    </div>
  );
}
