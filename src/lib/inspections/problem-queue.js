import { query } from "@/lib/db";
import { isChecklistType, failedItemsFrom } from "@/lib/inspections/checklists";

// The office's worklist of vehicle problems: inspections the driver flagged, and
// End Duty reports that named a defect.
//
// Read-only, and deliberately thin. Resolution is NOT modelled here — it is the
// existence of a vehiclemaintenance row linked by source_inspection_id, which is
// a real artifact with a real workflow behind it rather than a flag this module
// invents. uq_vehiclemaintenance_source_inspection (migration 121) is UNIQUE on
// that column, which is what lets the LEFT JOIN below be a join rather than a
// fan-out: at most one work order can ever match, so a row cannot multiply.
//
// "exists" means exists and is not archived. The join carries
// `AND wo.deleted_at IS NULL` because archiveVehicleMaintenance
// (vehicle.service.js) soft-deletes by PUT of deleted_at, every read in
// vehicle-maintenance/[id]/route.js filters on it, and the sibling check for
// incidents — incidents/route.js:92, the same "is this report tracked"
// question — joins with the same predicate. Counting an archived ticket as
// tracked would retire a driver-reported fault from the queue while nothing
// follows it up, which is the exact inversion this page exists to prevent.
//
// The three buckets. Both *_untracked ones are closable from the queue; only
// reported_untracked is COUNTED as an exception, because a failed Pre-Shift was
// already answered by the notification the office received when it happened,
// while a reported defect whose automatic raise failed is answered by nobody.
// See the plan, and src/lib/inspections/maintenance.js:53-55 for the automatic
// path this deliberately leaves alone.

export const PROBLEM_QUEUE_LIMIT = 100;

const QUEUE_SQL = `
  SELECT i.inspection_id, i.vehicle_id, i.inspection_type, i.inspection_date,
         i.status, i.severity, i.checklist, i.findings, i.driver_id,
         v.plate_number, v.vehicle_name,
         e.first_name, e.last_name,
         wo.maintenance_id, wo.status AS work_order_status
    FROM vehicleinspection i
    LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
    LEFT JOIN drivers d ON d.driver_id = i.driver_id
    LEFT JOIN employees e ON e.employee_id = d.employee_id
    LEFT JOIN vehiclemaintenance wo
           ON wo.source_inspection_id = i.inspection_id
          AND wo.deleted_at IS NULL
   WHERE i.status = 'Failed'
      OR (i.inspection_type = 'Post-Shift' AND i.status = 'Reported')
   ORDER BY i.inspection_date DESC, i.inspection_id DESC
   LIMIT $1 OFFSET $2
`;

// The strip's count, deliberately NOT derived from the query above: that one is
// capped by LIMIT, so a tally over its rows would silently stop counting at the
// page size and read as "under control" on the day it matters most. It has to
// apply the same archived-work-order rule as the list, or the strip would
// disagree with what is rendered directly beneath it.
const COUNT_SQL = `
  SELECT
    COUNT(*) FILTER (
      WHERE i.inspection_type = 'Post-Shift' AND i.status = 'Reported'
        AND wo.maintenance_id IS NULL
    )::int AS reported_untracked,
    COUNT(*) FILTER (
      WHERE i.status = 'Failed' AND wo.maintenance_id IS NULL
    )::int AS failed_untracked,
    COUNT(*) FILTER (WHERE wo.maintenance_id IS NOT NULL)::int AS tracked
    FROM vehicleinspection i
    LEFT JOIN vehiclemaintenance wo
           ON wo.source_inspection_id = i.inspection_id
          AND wo.deleted_at IS NULL
   WHERE i.status = 'Failed'
      OR (i.inspection_type = 'Post-Shift' AND i.status = 'Reported')
`;

/**
 * A reported defect is "untracked" only while no live repair ticket exists.
 *
 * Which is the whole point of the queue: raising the work order is best-effort
 * by design (raiseEndDutyWorkOrder explains why), so the failure case is a
 * vehicle with a driver-reported fault and nothing tracking it — visible to
 * nobody today.
 *
 * A failed Pre-Shift / Pre-Trip gets its own bucket rather than sharing this
 * one, because the two are counted differently on the dashboard even though both
 * can be closed from the queue. The split is by inspection_type, not by status
 * alone: 'Failed' happens to imply a checklist type today, but that is a
 * coincidence of the current writers rather than a rule, and depending on it
 * would break quietly the first time a Post-Shift fails.
 */
export function bucketFor(row) {
  if (row.maintenance_id) return "tracked";
  if (row.inspection_type === "Post-Shift") return "reported_untracked";
  return "failed_untracked";
}

/**
 * NULL is not "no severity" — it is "reported, and nobody assessed it".
 * standby.service.js:102-112 sets it that way on purpose. 'None' is a different
 * value: the driver's own assertion that they found nothing.
 */
export function severityLabel(severity) {
  const value = String(severity ?? "").trim();
  return value || "Not assessed";
}

/**
 * The driver's own words, in the shape the two record types actually store.
 *
 * Both branches end at `failedItemsFrom` for the checklist case — the
 * derivation of label and remark lives in checklists.js so this module and
 * Task 12's work-order description cannot disagree about what "the failed
 * items" are.
 *
 * Post-Shift is the other way round: `checklist` is NULL by construction
 * (standby.service.js:109) and `findings` is the driver's free text.
 */
export function driverReport(row) {
  if (isChecklistType(row.inspection_type)) {
    return { kind: "checklist", items: failedItemsFrom(row.checklist) };
  }
  return { kind: "free_text", text: String(row.findings ?? "").trim() };
}

function shape(row) {
  return {
    inspectionId: row.inspection_id,
    vehicleId: row.vehicle_id,
    plateNumber: row.plate_number ?? null,
    vehicleName: row.vehicle_name ?? null,
    // driver_id is nullable on this table, so first_name/last_name can both be
    // null — join them rather than assuming a reporter exists.
    driverName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
    inspectionType: row.inspection_type,
    inspectionDate: row.inspection_date,
    status: row.status,
    severity: row.severity ?? null,
    severityLabel: severityLabel(row.severity),
    report: driverReport(row),
    workOrderId: row.maintenance_id ?? null,
    workOrderStatus: row.work_order_status ?? null,
    bucket: bucketFor(row),
  };
}

export async function listVehicleProblems({ limit = PROBLEM_QUEUE_LIMIT, offset = 0 } = {}) {
  const { rows } = await query(QUEUE_SQL, [limit, offset]);
  const items = rows.map(shape);
  return {
    items,
    counts: {
      reportedUntracked: items.filter((i) => i.bucket === "reported_untracked").length,
      failedUntracked: items.filter((i) => i.bucket === "failed_untracked").length,
      tracked: items.filter((i) => i.bucket === "tracked").length,
    },
  };
}

export async function countProblemCounts() {
  const { rows } = await query(COUNT_SQL);
  const row = rows[0] ?? {};
  return {
    reportedUntracked: row.reported_untracked ?? 0,
    failedUntracked: row.failed_untracked ?? 0,
    tracked: row.tracked ?? 0,
  };
}
