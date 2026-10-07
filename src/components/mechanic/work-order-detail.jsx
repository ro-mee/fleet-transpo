"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Minus, Plus, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn, formatDate } from "@/lib/utils";
import {
  DESKTOP_ONLY_TITLE,
  buildMechanicUpdateBody,
  jobProblem,
  jobVehicle,
  nextMechanicAction,
  serializeParts,
  validateDiagnosis,
  DIAGNOSIS_MAX_LENGTH,
} from "./mechanic-actions";
import { useIsDesktop } from "./use-is-desktop";

// Work-order detail for the mechanic: timeline, vehicle snapshot, problem,
// and the evidence form. The form NEVER renders cost/vehicle/priority/
// assignment inputs — those keys are staff-only and the submit body is built
// through buildMechanicUpdateBody, so they cannot be sent by accident.
//
// Read-contract note: the post-4b lean projection is a read-only superset —
// it CARRIES assigned_at / repair_started_at / repair_completed_at plus the
// evidence keys (diagnosis, parts_replaced, labor_hours, rejection_reason,
// completed_date), so milestones render real stamps where present and
// "Not recorded" where a stamp is absent (never a guessed timestamp). The
// evidence form opens prefilled from the row so the mechanic edits what is
// already recorded; a scoped single-record read is the follow-up.

const MILESTONES = ["Assigned", "Started", "Submitted"];

function milestoneIndex(status) {
  if (status === "Scheduled") return 0;
  if (status === "In Progress") return 1;
  if (status === "Pending Inspection" || status === "Completed") return 2;
  // Cancelled is terminal without progress: only Assigned reads as done.
  if (status === "Cancelled") return 0;
  return 0;
}

function Timeline({ workOrder }) {
  const current = milestoneIndex(workOrder.status);
  const stamps = {
    Assigned: workOrder.assigned_at ?? null,
    Started: workOrder.repair_started_at ?? null,
    // Prefer the exact repair stamp; fall back to completed_date for
    // staff-direct completions that leave repair_completed_at NULL.
    Submitted: workOrder.repair_completed_at ?? workOrder.completed_date ?? null,
  };
  return (
    <ol aria-label="Work order timeline" className="list-none space-y-0 p-0">
      {MILESTONES.map((label, i) => {
        const done = i <= current;
        const stamp = stamps[label];
        const Icon = done ? CheckCircle2 : Circle;
        return (
          <li key={label} className="relative flex gap-3 pb-5 last:pb-0">
            {i < MILESTONES.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[9px] top-6 h-[calc(100%-1.25rem)] w-0.5",
                  i < current ? "bg-success" : "bg-border"
                )}
              />
            )}
            <Icon
              aria-hidden="true"
              className={cn(
                "h-5 w-5 shrink-0",
                done ? "text-success" : "text-foreground-muted"
              )}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{label}</p>
              <p className="text-xs text-foreground-secondary">
                {stamp ? formatDate(stamp) : "Not recorded"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PartsEditor({ rows, onChange, disabled }) {
  const setRow = (index, patch) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange(next);
  };
  const removeRow = (index) => {
    if (rows.length <= 1) {
      onChange([{ name: "", qty: 1 }]);
      return;
    }
    onChange(rows.filter((_, i) => i !== index));
  };
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label
              htmlFor={`part-name-${i}`}
              className="block text-xs font-semibold text-foreground"
            >
              Part name
            </label>
            <input
              id={`part-name-${i}`}
              name={`part-name-${i}`}
              type="text"
              value={row.name}
              disabled={disabled}
              onChange={(e) => setRow(i, { name: e.target.value })}
              placeholder="e.g. Brake pad set"
              className="h-[44px] w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
            />
          </div>
          <div className="w-24 shrink-0 space-y-1">
            <label htmlFor={`part-qty-${i}`} className="block text-xs font-semibold text-foreground">
              Qty
            </label>
            <input
              id={`part-qty-${i}`}
              name={`part-qty-${i}`}
              type="number"
              min="1"
              step="1"
              value={row.qty}
              disabled={disabled}
              onChange={(e) => setRow(i, { qty: e.target.value })}
              className="h-[44px] w-full rounded-control border border-border bg-surface px-3 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            title={disabled ? DESKTOP_ONLY_TITLE : "Remove part"}
            aria-label={`Remove part ${i + 1}`}
            onClick={() => removeRow(i)}
            className="h-[44px] w-[44px] shrink-0 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        title={disabled ? DESKTOP_ONLY_TITLE : undefined}
        onClick={() => onChange([...rows, { name: "", qty: 1 }])}
        className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Add part
      </Button>
    </div>
  );
}

export function WorkOrderDetail({
  workOrder,
  desktop,
  onSubmit,
  submitting = false,
  serverError = null,
  initialDiagnosis,
}) {
  const detected = useIsDesktop();
  const isDesktop = desktop ?? detected;

  const [diagnosis, setDiagnosis] = useState(
    initialDiagnosis ?? workOrder?.diagnosis ?? ""
  );
  const [parts, setParts] = useState([{ name: "", qty: 1 }]);
  const [laborHours, setLaborHours] = useState(
    workOrder?.labor_hours != null ? String(workOrder.labor_hours) : ""
  );
  const [remarks, setRemarks] = useState("");

  if (!workOrder) return null;

  const diagnosisError = validateDiagnosis(diagnosis);
  const partsValue = serializeParts(parts);
  const laborValue = laborHours === "" ? undefined : Number(laborHours);
  const laborError =
    laborHours !== "" && !(Number.isFinite(laborValue) && laborValue > 0)
      ? "Labor hours must be a positive number."
      : null;
  const hasEvidence =
    String(diagnosis).trim().length > 0 || partsValue.length > 0 || laborHours !== "";
  const canSave = isDesktop && !submitting && !diagnosisError && !laborError && hasEvidence;

  const evidenceBody = () =>
    buildMechanicUpdateBody({
      diagnosis,
      parts: partsValue,
      laborHours: laborValue,
      remarks,
    });

  const action = nextMechanicAction(workOrder.status);
  const actionDisabled = !isDesktop || submitting;
  const vehicle = jobVehicle(workOrder);
  const problem = jobProblem(workOrder);

  return (
    <div className="space-y-4">
      <Card className="rounded-card border-border/70 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-5 w-5 text-foreground-secondary" aria-hidden="true" />
            {vehicle.plate ?? `WO #${workOrder.maintenance_id}`}
            {vehicle.name && (
              <span className="text-sm font-normal text-foreground-secondary">{vehicle.name}</span>
            )}
          </CardTitle>
          <StatusBadge status={workOrder.status} entity="maintenance" />
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <Timeline workOrder={workOrder} />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-foreground-muted">Job type</dt>
              <dd className="font-medium text-foreground">{workOrder.maintenance_type ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-foreground-muted">Scheduled</dt>
              <dd className="font-medium text-foreground">
                {workOrder.maintenance_date ? formatDate(workOrder.maintenance_date) : "—"}
              </dd>
            </div>
            {workOrder.mileage_at_service != null && (
              <div className="flex justify-between gap-2">
                <dt className="text-foreground-muted">Odometer at service</dt>
                <dd className="font-data font-semibold tabular-nums text-foreground">
                  {Number(workOrder.mileage_at_service).toLocaleString()} km
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-foreground-muted">Priority</dt>
              <dd className="font-medium text-foreground">{workOrder.priority ?? "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {problem && (
        <Card className="rounded-card border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Problem reported</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{problem}</p>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-card border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Findings &amp; evidence</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            aria-label="Evidence form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSave) return;
              onSubmit?.(evidenceBody());
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label htmlFor="wo-diagnosis" className="block text-xs font-semibold text-foreground">
                Diagnosis
              </label>
              <textarea
                id="wo-diagnosis"
                name="diagnosis"
                value={diagnosis}
                disabled={!isDesktop || submitting}
                onChange={(e) => setDiagnosis(e.target.value)}
                rows={4}
                maxLength={DIAGNOSIS_MAX_LENGTH + 500}
                aria-invalid={diagnosisError ? "true" : undefined}
                aria-describedby="wo-diagnosis-count wo-diagnosis-error"
                placeholder="What did you find, and what did you do about it?"
                className="min-h-[44px] w-full rounded-control border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
              />
              <div className="flex items-center justify-between gap-2">
                <p id="wo-diagnosis-count" className="text-[11px] tabular-nums text-foreground-muted">
                  {String(diagnosis).length}/{DIAGNOSIS_MAX_LENGTH}
                </p>
              </div>
              {diagnosisError && (
                <p id="wo-diagnosis-error" role="alert" className="text-xs font-medium text-danger-700">
                  {diagnosisError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-foreground">Parts replaced</p>
              <PartsEditor rows={parts} onChange={setParts} disabled={!isDesktop || submitting} />
              <p className="text-[11px] text-foreground-muted">
                Saved as a list — empty rows are ignored.
              </p>
            </div>

            <div className="max-w-48 space-y-1.5">
              <label htmlFor="wo-labor" className="block text-xs font-semibold text-foreground">
                Labor hours
              </label>
              <input
                id="wo-labor"
                name="labor_hours"
                type="number"
                min="0"
                step="0.25"
                value={laborHours}
                disabled={!isDesktop || submitting}
                onChange={(e) => setLaborHours(e.target.value)}
                aria-invalid={laborError ? "true" : undefined}
                placeholder="e.g. 2.5"
                className="h-[44px] w-full rounded-control border border-border bg-surface px-3 text-sm tabular-nums text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
              />
              {laborError && (
                <p role="alert" className="text-xs font-medium text-danger-700">{laborError}</p>
              )}
            </div>

            <details className="rounded-control border border-border/70 px-3 py-2">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                Add a handover note (optional)
              </summary>
              <div className="space-y-1.5 pb-2 pt-1">
                <label htmlFor="wo-remarks" className="block text-xs font-semibold text-foreground">
                  Handover note
                </label>
                <textarea
                  id="wo-remarks"
                  name="remarks"
                  value={remarks}
                  disabled={!isDesktop || submitting}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  placeholder="Anything the inspector should know."
                  className="min-h-[44px] w-full rounded-control border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
                />
              </div>
            </details>

            {serverError && (
              <p role="alert" className="text-xs font-medium text-danger-700">{serverError}</p>
            )}

            <Button
              type="submit"
              disabled={!canSave}
              title={!isDesktop ? DESKTOP_ONLY_TITLE : undefined}
              className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {submitting ? "Saving…" : "Save findings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {action && (
        <div className="sticky bottom-0 z-10 rounded-card border border-border/70 bg-surface/95 p-3 shadow-md backdrop-blur motion-reduce:shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-foreground-secondary">
              {action.to === "In Progress"
                ? "Starting the job stamps the repair clock."
                : "Marking ready hands the job to the Fleet Manager for inspection."}
            </p>
            <Button
              type="button"
              disabled={actionDisabled}
              title={!isDesktop ? DESKTOP_ONLY_TITLE : undefined}
              onClick={() => onSubmit?.({ ...evidenceBody(), status: action.to })}
              className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {submitting ? "Working…" : action.label}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
