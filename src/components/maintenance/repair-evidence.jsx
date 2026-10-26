import { formatDate } from "@/lib/utils";
import { repairPerformerLabel } from "@/lib/maintenance/performer";

// Shared by both staff review dialogs; these are saved mechanic findings,
// separate from the original work-order description and current assignment.
export function RepairEvidence({ record }) {
  const parts = Array.isArray(record.parts_replaced) ? record.parts_replaced : [];
  return (
    <section aria-label="Saved repair findings" className="space-y-3 rounded-control border border-border bg-hover/30 p-4">
      <h3 className="text-sm font-semibold text-foreground">Saved repair findings</h3>
      {record.status === "Pending Inspection" && (
        <p className="text-xs text-foreground-secondary">
          Review the mechanic’s findings before approving completion. Return to In Progress with a reason if more repair is needed.
        </p>
      )}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold text-foreground-secondary">Diagnosis</dt>
          <dd className="whitespace-pre-wrap break-words">{record.diagnosis || "Not recorded"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-foreground-secondary">Parts replaced</dt>
          <dd className="break-words">
            {parts.length ? (
              <ul className="list-inside list-disc">
                {parts.map((part, index) => (
                  <li key={index}>
                    {typeof part === "string" ? part : `${part?.name ?? part?.part_name ?? part?.part ?? "Unnamed part"} × ${part?.qty ?? part?.quantity ?? 1}`}
                  </li>
                ))}
              </ul>
            ) : typeof record.parts_replaced === "string" && record.parts_replaced.trim() ? record.parts_replaced : "Not recorded"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-foreground-secondary">Labor</dt>
          <dd className="tabular-nums">{record.labor_hours != null && record.labor_hours !== "" ? `${record.labor_hours} hours` : "Not recorded"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-foreground-secondary">Performed by</dt>
          <dd>{repairPerformerLabel(record)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-foreground-secondary">Last submitted for review</dt>
          <dd>{record.repair_completed_at ? formatDate(record.repair_completed_at) : "Not recorded"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold text-foreground-secondary">Handover notes</dt>
          <dd className="whitespace-pre-wrap break-words">{record.remarks || "Not recorded"}</dd>
        </div>
        {record.rejection_reason && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-foreground-secondary">Last return reason</dt>
            <dd className="whitespace-pre-wrap break-words">{record.rejection_reason}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
