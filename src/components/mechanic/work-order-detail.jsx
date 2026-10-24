"use client";

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useState } from "react";
import { CheckCircle2, Circle, Minus, Plus, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn, formatDate } from "@/lib/utils";
import {
  buildMechanicUpdateBody,
  jobProblem,
  jobVehicle,
  nextMechanicAction,
  serializeParts,
  sourceLabels,
  validateDiagnosis,
  DIAGNOSIS_MAX_LENGTH,
} from "./mechanic-actions";
import { VehicleHistory } from "./vehicle-history";

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
// evidence form opens with the saved diagnosis, parts, labor, and handover note.

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
            title={disabled ? "Saving work order" : "Remove part"}
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
        title={disabled ? "Saving work order" : undefined}
        onClick={() => onChange([...rows, { name: "", qty: 1 }])}
        className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Add part
      </Button>
    </div>
  );
}

function SavedEvidenceCompleteness({ workOrder }) {
  const items = [
    { label: "Diagnosis", complete: String(workOrder.diagnosis ?? "").trim().length > 0 },
    {
      label: "Parts",
      complete: Array.isArray(workOrder.parts_replaced)
        ? workOrder.parts_replaced.length > 0
        : String(workOrder.parts_replaced ?? "").trim().length > 0,
    },
    { label: "Labor", complete: workOrder.labor_hours != null && Number(workOrder.labor_hours) > 0 },
  ];
  const completeCount = items.filter((item) => item.complete).length;

  return (
    <div role="group" aria-label={`Saved evidence completeness: ${completeCount} of ${items.length} recorded`} className="space-y-2 border-b border-border pb-4">
      <p className="text-xs font-semibold text-foreground">Saved evidence · {completeCount} of {items.length} recorded</p>
      <ul className="flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
        {items.map((item) => {
          const Icon = item.complete ? CheckCircle2 : Circle;
          return (
            <li key={item.label} className="inline-flex items-center gap-1.5 text-xs text-foreground-secondary">
              <Icon className={cn("h-4 w-4", item.complete ? "text-success-700" : "text-foreground-muted")} aria-hidden="true" />
              {item.label}: {item.complete ? "Saved" : "Missing"}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function partsEditorRows(savedParts) {
  if (!Array.isArray(savedParts) || savedParts.length === 0) {
    return [{ name: "", qty: 1 }];
  }
  return savedParts.map((part) => {
    const name = typeof part === "string"
      ? part
      : String(part?.name ?? part?.part_name ?? part?.part ?? (part ? JSON.stringify(part) : ""));
    const qty = typeof part === "object" && part !== null
      ? part.qty ?? part.quantity ?? 1
      : 1;
    return { name, qty: String(qty) };
  });
}

function WorkDetailTileSkeleton({ labelWidth = "w-20", valueWidth = "w-28" }) {
  return (
    <div className="min-w-0 rounded-control bg-hover p-3">
      <Skeleton className={`h-3 ${labelWidth}`} />
      <Skeleton className={`mt-2 h-4 ${valueWidth}`} />
    </div>
  );
}

function TimelineItemSkeleton() {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-28" />
      </div>
    </li>
  );
}

/** Loading state uses the same cards and responsive columns as the loaded detail. */
export function WorkOrderDetailSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid items-start gap-4 xl:grid-cols-2"
    >
      <span role="status" className="sr-only">Loading work order details</span>
      <div aria-hidden="true" className="min-w-0 space-y-4">
        <Card className="rounded-card border-border/70 shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
            </CardTitle>
            <Skeleton className="h-7 w-28 rounded-full" />
          </CardHeader>
          <CardContent className="space-y-4">
            <section aria-hidden="true" className="min-w-0">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Work details</h3>
              <dl className="grid grid-cols-2 gap-3">
                <WorkDetailTileSkeleton labelWidth="w-14" valueWidth="w-28" />
                <WorkDetailTileSkeleton labelWidth="w-16" valueWidth="w-24" />
                <WorkDetailTileSkeleton labelWidth="w-28" valueWidth="w-20" />
                <WorkDetailTileSkeleton labelWidth="w-12" valueWidth="w-16" />
              </dl>
            </section>
            <section aria-hidden="true" className="border-t border-border/70 pt-4">
              <h3 className="text-sm font-semibold text-foreground">Problem reported</h3>
              <div className="mt-2 space-y-2">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </section>
          </CardContent>
        </Card>
        <VehicleHistory isLoading />
      </div>

      <div aria-hidden="true" className="min-w-0 space-y-4">
        <Card className="rounded-card border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Repair timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol aria-hidden="true" className="list-none space-y-0 p-0">
              {MILESTONES.map((milestone) => <TimelineItemSkeleton key={milestone} />)}
            </ol>
          </CardContent>
        </Card>

        <Card className="rounded-card border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Findings &amp; evidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div aria-hidden="true" className="space-y-2 border-b border-border pb-4">
              <Skeleton className="h-3.5 w-40" />
              <ul className="flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
                {["diagnosis", "parts", "labor"].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-3 w-20" />
                  </li>
                ))}
              </ul>
            </div>

            <div aria-hidden="true" className="space-y-4">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-[118px] w-full rounded-control" />
                <Skeleton className="h-3 w-12" />
              </div>

              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-[44px] w-full rounded-control" />
                  </div>
                  <div className="w-24 shrink-0 space-y-1">
                    <Skeleton className="h-3 w-8" />
                    <Skeleton className="h-[44px] w-full rounded-control" />
                  </div>
                  <Skeleton className="h-[44px] w-[44px] shrink-0 rounded-control" />
                </div>
                <Skeleton className="h-[44px] w-24 rounded-control" />
                <Skeleton className="h-3 w-48" />
              </div>

              <div className="max-w-48 space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-[44px] w-full rounded-control" />
              </div>

              <Skeleton className="h-11 w-full rounded-control" />
              <Skeleton className="h-[44px] w-32 rounded-control" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function WorkOrderDetail({
  workOrder,
  onSubmit,
  onEdit,
  submitting = false,
  serverError = null,
  saveSuccess = false,
  history = null,
  historyLoading = false,
  historyError = null,
}) {
  const [diagnosis, setDiagnosis] = useState(
    workOrder?.diagnosis ?? ""
  );
  const [parts, setParts] = useState(() => partsEditorRows(workOrder?.parts_replaced));
  const [laborHours, setLaborHours] = useState(
    workOrder?.labor_hours != null ? String(workOrder.labor_hours) : ""
  );
  const [itemOutcomes,setItemOutcomes]=useState(()=>workOrder?.inspection_outcomes ?? []);
  const [outcomesEdited,setOutcomesEdited]=useState(false);
  const outcomeError=itemOutcomes.some(item=>!item.evidence?.trim() || !item.outcome);
  const editItemOutcome=(key,patch)=>{
    setItemOutcomes(items=>{const previous=items.find(i=>i.checklist_item_id===key) ?? {checklist_item_id:key,outcome:"",evidence:""};return [...items.filter(i=>i.checklist_item_id!==key),{...previous,...patch}];});
    setOutcomesEdited(true);onEdit?.();
  };
  const [remarks, setRemarks] = useState(workOrder?.remarks ?? "");

  if (!workOrder) return null;

  const diagnosisError = validateDiagnosis(diagnosis);
  const partsValue = serializeParts(parts);
  const laborValue = laborHours === "" ? undefined : Number(laborHours);
  const laborError =
    laborHours !== "" && !(Number.isFinite(laborValue) && laborValue > 0)
      ? "Labor hours must be a positive number."
      : null;
  const hasEvidence =
    String(diagnosis).trim().length > 0 || partsValue.length > 0 || laborHours !== "" || String(remarks).trim().length > 0 || outcomesEdited;
  const canSave = !submitting && !diagnosisError && !laborError && (!outcomesEdited || !outcomeError) && hasEvidence;

  const evidenceBody = () =>
    buildMechanicUpdateBody({
      diagnosis,
      inspection_outcomes:outcomesEdited?itemOutcomes.map(({checklist_item_id,outcome,evidence})=>({checklist_item_id,outcome,evidence})):undefined,
      parts: partsValue,
      laborHours: laborValue,
      remarks,
    });

  const action = nextMechanicAction(workOrder.status);
  const actionDisabled = submitting || (outcomesEdited && outcomeError);
  const vehicle = jobVehicle(workOrder);
  const problem = jobProblem(workOrder);
  const sources = sourceLabels(workOrder);

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <div className="min-w-0 space-y-4">
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
          {sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-6 pb-1">
              {sources.map((label) => (
                <span
                  key={label}
                  title="Where this job originated"
                  className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-foreground-secondary"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          <CardContent className="space-y-4">
            <section aria-labelledby="work-details-heading" className="min-w-0">
              <h3 id="work-details-heading" className="mb-3 text-sm font-semibold text-foreground">
                Work details
              </h3>
              <dl className="grid grid-cols-2 gap-3">
                <div className="min-w-0 rounded-control bg-hover p-3">
                  <dt className="text-xs font-medium text-foreground-secondary">Job type</dt>
                  <dd className="mt-1 break-words text-sm font-semibold text-foreground">
                    {workOrder.maintenance_type ?? "—"}
                  </dd>
                </div>
                <div className="min-w-0 rounded-control bg-hover p-3">
                  <dt className="text-xs font-medium text-foreground-secondary">Scheduled</dt>
                  <dd className="mt-1 break-words text-sm font-semibold text-foreground">
                    {workOrder.maintenance_date ? formatDate(workOrder.maintenance_date) : "—"}
                  </dd>
                </div>
                <div className="min-w-0 rounded-control bg-hover p-3">
                  <dt className="text-xs font-medium text-foreground-secondary">Odometer at service</dt>
                  <dd className="mt-1 break-words font-data text-sm font-semibold tabular-nums text-foreground">
                    {workOrder.mileage_at_service != null
                      ? `${Number(workOrder.mileage_at_service).toLocaleString()} km`
                      : "—"}
                  </dd>
                </div>
                <div className="min-w-0 rounded-control bg-hover p-3">
                  <dt className="text-xs font-medium text-foreground-secondary">Priority</dt>
                  <dd className="mt-1 break-words text-sm font-semibold text-foreground">{workOrder.priority ?? "—"}</dd>
                </div>
              </dl>
            </section>
            {problem && (
              <section aria-labelledby="reported-problem-heading" className="border-t border-border/70 pt-4">
                <h3 id="reported-problem-heading" className="text-sm font-semibold text-foreground">
                  Problem reported
                </h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground-secondary">
                  {problem}
                </p>
              </section>
            )}
          </CardContent>
        </Card>
        <VehicleHistory history={history} isLoading={historyLoading} loadError={historyError} />
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="rounded-card border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Repair timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline workOrder={workOrder} />
          </CardContent>
        </Card>

        <Card className="rounded-card border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Findings &amp; evidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
          <SavedEvidenceCompleteness workOrder={workOrder} />
          <form
            aria-label="Evidence form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSave) return;
              onSubmit?.(evidenceBody());
            }}
            className="space-y-4"
          >
            {(workOrder.inspection_items ?? []).map(item=>{
              const saved=itemOutcomes.find(i=>i.checklist_item_id===item.checklist_item_id);
              const title=item.checklist_item_id==="brakes_tires"?"Brakes and tires":item.checklist_item_id.replaceAll("_"," ");
              return <fieldset key={item.checklist_item_id} className="space-y-2 border-b border-border/70 pb-4">
                <legend className="text-sm font-semibold capitalize text-foreground">{title}</legend>
                <p className="text-xs text-foreground-secondary">Inspection reports: {item.inspection_ids.join(", ")}</p>
                <p className="text-xs text-foreground-secondary">Record what you checked. The Fleet Manager reviews this with the completed work.</p>
                <Select value={saved?.outcome ?? ""} onValueChange={outcome=>editItemOutcome(item.checklist_item_id,{outcome})} disabled={submitting}>
                  <SelectTrigger aria-label={title+" outcome"} className="min-h-[44px]"><SelectValue placeholder="Choose an outcome" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirmed">Confirmed and repaired</SelectItem>
                    <SelectItem value="not_confirmed">Not confirmed</SelectItem>
                    <SelectItem value="inconclusive">Inconclusive — needs review</SelectItem>
                  </SelectContent>
                </Select>
                <label htmlFor={"wo-outcome-"+item.checklist_item_id} className="block text-xs font-semibold text-foreground">Outcome evidence</label>
                <textarea id={"wo-outcome-"+item.checklist_item_id} value={saved?.evidence ?? ""} maxLength={1000} rows={2} disabled={submitting}
                  onChange={e=>editItemOutcome(item.checklist_item_id,{evidence:e.target.value})}
                  aria-describedby={"wo-outcome-help-"+item.checklist_item_id}
                  className="min-h-[44px] w-full rounded-control border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60" />
                <p id={"wo-outcome-help-"+item.checklist_item_id} className="text-xs text-foreground-secondary">Choose an outcome and describe the checks or repair before saving.</p>
              </fieldset>;
            })}
            <div className="space-y-1.5">
              <label htmlFor="wo-diagnosis" className="block text-xs font-semibold text-foreground">
                Diagnosis
              </label>
              <textarea
                id="wo-diagnosis"
                name="diagnosis"
                value={diagnosis}
                disabled={submitting}
                onChange={(e) => {
                  setDiagnosis(e.target.value);
                  onEdit?.();
                }}
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
              <PartsEditor
                rows={parts}
                onChange={(next) => {
                  setParts(next);
                  onEdit?.();
                }}
                disabled={submitting}
              />
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
                disabled={submitting}
                onChange={(e) => {
                  setLaborHours(e.target.value);
                  onEdit?.();
                }}
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
                  disabled={submitting}
                  onChange={(e) => {
                    setRemarks(e.target.value);
                    onEdit?.();
                  }}
                  rows={2}
                  placeholder="Anything the inspector should know."
                  className="min-h-[44px] w-full rounded-control border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
                />
              </div>
            </details>

            {serverError && (
              <p role="alert" className="text-xs font-medium text-danger-700">{serverError}</p>
            )}
            {saveSuccess && !submitting && (
              <p role="status" className="text-xs font-medium text-success-700">Findings saved.</p>
            )}

            <Button
              type="submit"
              disabled={!canSave}
              className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {submitting ? "Saving…" : "Save findings"}
            </Button>
          </form>
          </CardContent>
        </Card>
      </div>

      {action && (
        <div className="sticky bottom-0 z-10 rounded-card border border-border/70 bg-surface/95 p-3 shadow-md backdrop-blur motion-reduce:shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-foreground-secondary">
              {action.to === "In Progress"
                ? "Starting the job stamps the repair clock."
                : "Marking ready hands the job to the Fleet Manager for inspection."}
            </p>
            <Button
              type="button"
              disabled={actionDisabled}
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
