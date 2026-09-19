"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { formatDateTime } from "@/lib/utils";

// Read-only evidence drawer (Phase B2). Displays server-verified proof for one
// signed evidence reference. GET-only: fetches exactly once per opened proof
// (effect deps are [proofRef, requestId] ONLY — planStatus changes never
// refetch). Never validates, polls, reranks, selects, assigns, or mutates.
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
      <p className="mt-1 font-semibold text-danger">CONFLICT — windows overlap</p>
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

export function EvidenceDrawer({ requestId, proof, inspector = null, backTo = null, planStatus = null, onClose, onBack, onReviewProof }) {
  const proofRef = proof?.ref ?? null;
  const proofType = proof?.type ?? null;
  const [state, setState] = useState({ status: "loading", data: null, error: null });

  useEffect(() => {
    if (!proofRef || !requestId) return;
    let cancelled = false;
    fetchEvidence(requestId, proofRef).then(
      data => { if (!cancelled) setState({ status: "ready", data, error: null }); },
      error => { if (!cancelled) setState({ status: "error", data: null, error }); }
    );
    return () => { cancelled = true; };
    // INTENTIONAL dep scope: planStatus excluded — validation changes never refetch.
  }, [proofRef, requestId]);

  const headerTitle = inspector ? "Eligibility Evidence" : (state.data?.title ?? "Evidence");
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`${headerTitle} evidence`}
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-lg"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{headerTitle}</h2>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-foreground-secondary">Read-only evidence</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close evidence"
          className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
        >
          Close
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto space-y-3 p-3">
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
          <p role="alert" className="text-sm text-danger">
            This evidence is unavailable{state.error?.message ? `: ${state.error.message}` : "."} Ask Copilot again for fresh evidence.
          </p>
        )}
        {state.status === "ready" && <EvidenceBody data={state.data} proofType={proofType} planStatus={planStatus} />}
        {backTo && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
          >
            Back to checklist
          </button>
        )}
          </>
        )}
      </div>
    </aside>
  );
}

// Option comparison from live server evaluation (B4). Codes, bands and
// facts only — scores are never exposed and never rendered.
export function ComparisonCard({ data, planStatus = null }) {
  const facts = data?.facts ?? {};
  const { optionA, optionB, hierarchy = [] } = facts;
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
          <p className="mb-1 font-semibold text-foreground">Option 1</p>
          {cell(optionA)}
        </div>
        <div className="rounded-lg border border-border/60 px-2.5 py-1.5">
          <p className="mb-1 font-semibold text-foreground">Option 2</p>
          {cell(optionB)}
        </div>
      </div>
      {hierarchy.length > 0 && (
        <div className="rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] text-foreground-secondary">
          <p className="font-medium text-foreground">Server ranking order</p>
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
      rows.push({ label: c.label, state: "blocked", note: "See exclusion proof", proof: null });
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

const ROW_STATE_LABEL = { clear: "Clear", blocked: "Blocked", verify: "Needs verification", na: "—" };

export function EligibilityInspector({ pairLabel, horizon, rows, onReviewProof }) {
  return (
    <div className="space-y-2">
      {pairLabel && <p className="text-xs font-medium text-foreground">{pairLabel}</p>}
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
                onClick={() => onReviewProof?.(row.proof)}
                className="mt-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
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
      <p className="text-[11px] text-foreground-secondary">Eligible based on the evaluated server evidence.</p>
    </div>
  );
}
