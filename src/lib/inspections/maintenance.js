import { query, withTransaction } from "@/lib/db";
import { sendPush } from "@/services/push.service";
import { buildInspectionMaintenancePayload, buildChecklistMaintenancePayload } from "@/lib/inspections/report";
import { failedItemsFrom } from "@/lib/inspections/checklists";
import { shouldGroundReportedDefect } from "@/lib/driver/grounding";
import { notificationRolesFor } from "@/lib/notifications/recipients";
import { writeAppError } from "@/lib/app-errors";

// The ONE place an End Duty report becomes a maintenance work order.
//
// Mirrors src/lib/incidents/maintenance.js, and the similarity is deliberate:
// both raise a work order from a driver-originated report about a vehicle, and
// both must survive a retry. The row lock plus the unique source_inspection_id
// index (migration 121) are what make the retry safe — and a retry is expected
// here rather than exotic, because this is filed from a phone at the end of a
// shift, possibly on one bar of signal.
//
// One difference from the incident path, and it is not an omission: there is no
// back-link UPDATE on the source row. driverincidents carries maintenance_id;
// vehicleinspection does not, and adding one would duplicate what
// source_inspection_id already answers from the other direction.

const SELECT_WORK_ORDER = `SELECT maintenance_id, vehicle_id, maintenance_type, maintenance_date,
                                  status, priority, cost, source_inspection_id
                             FROM vehiclemaintenance
                            WHERE source_inspection_id = $1
                            ORDER BY maintenance_id DESC
                            LIMIT 1`;

/**
 * Create or recover the single work order belonging to an End Duty report.
 * Returns a discriminated result rather than throwing for the ordinary
 * outcomes — "nothing was reported" is not an error.
 */
export async function ensureInspectionMaintenance({ inspectionId, session, allowChecklistType = false }) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      // FOR UPDATE OF i: a bare FOR UPDATE cannot lock the nullable side of a
      // LEFT JOIN, and the lock is what serialises two retries of the same
      // submission racing each other.
      //
      // severity and checklist are read for the office path only; the End Duty
      // path ignores both.
      `SELECT i.inspection_id, i.vehicle_id, i.inspection_type, i.findings,
              i.severity, i.checklist, v.plate_number
         FROM vehicleinspection i
         LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
        WHERE i.inspection_id = $1
        FOR UPDATE OF i`,
      [inspectionId]
    );
    const inspection = rows[0];
    if (!inspection) return { notFound: true };

    // Only End Duty reports raise work orders automatically. A failed Pre-Shift
    // or Pre-Trip is a different workflow and deliberately not wired here —
    // those failures are recorded and escalate to nobody (a known residual,
    // noted in the vault).
    //
    // allowChecklistType is the ONE way past this, and only the office route
    // sets it: a person, looking at one specific failed inspection, deciding to
    // raise a ticket for it. Nothing a driver does reaches it.
    const isChecklistType = inspection.inspection_type !== "Post-Shift";
    if (isChecklistType && !allowChecklistType) {
      return { notRequired: true, inspection };
    }

    // "Nothing unusual" is a real answer and raises nothing. Only a reported
    // observation becomes a work order, which is the entire point of the
    // two-way flag on the request.
    const findings = String(inspection.findings ?? "").trim();
    if (!isChecklistType && !findings) return { notReported: true, inspection };

    // A 'Failed' checklist row always carries at least one FAIL — the route
    // cannot write one otherwise. This guards a row written outside that route;
    // it is not a case the app produces.
    const failedItems = isChecklistType ? failedItemsFrom(inspection.checklist) : [];
    if (isChecklistType && !failedItems.length) return { notReported: true, inspection };

    const { rows: existingRows } = await tx.query(SELECT_WORK_ORDER, [inspection.inspection_id]);
    if (existingRows[0]) return { workOrder: existingRows[0], created: false, inspection };

    const payload = isChecklistType
      ? buildChecklistMaintenancePayload({
          inspectionId: inspection.inspection_id,
          vehicleId: inspection.vehicle_id,
          plateNumber: inspection.plate_number,
          inspectionType: inspection.inspection_type,
          severity: inspection.severity,
          failedItems,
        })
      : buildInspectionMaintenancePayload({
          inspectionId: inspection.inspection_id,
          vehicleId: inspection.vehicle_id,
          plateNumber: inspection.plate_number,
          findings,
          // Derived from the stored row rather than trusted from the caller: the
          // decision that takes a vehicle out of dispatch should not depend on
          // the route having passed the right boolean.
          grounded: shouldGroundReportedDefect(findings),
        });

    const { rows: insertedRows } = await tx.query(
      `INSERT INTO vehiclemaintenance
         (vehicle_id, maintenance_date, maintenance_type, description,
          cost, status, priority, remarks, created_by, source_inspection_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING maintenance_id, vehicle_id, maintenance_type, maintenance_date,
                 status, priority, cost, source_inspection_id`,
      [
        inspection.vehicle_id,
        payload.maintenance_date,
        payload.maintenance_type,
        payload.description,
        payload.cost,
        payload.status,
        payload.priority,
        payload.remarks,
        // Null for a driver submission: these are employees, and the reporter is
        // a driver. created_by records the staff member who raised it manually,
        // not the driver whose report it was — that link is source_inspection_id.
        session?.user?.employeeId ?? null,
        inspection.inspection_id,
      ]
    );
    const workOrder = insertedRows[0];
    if (!workOrder) {
      const { rows: recoveredRows } = await tx.query(SELECT_WORK_ORDER, [inspection.inspection_id]);
      if (!recoveredRows[0]) throw new Error("End Duty work order could not be created");
      return { workOrder: recoveredRows[0], created: false, inspection };
    }
    return { workOrder, created: true, inspection };
  });
}

/**
 * Notify only the roles that own the maintenance queue. Failure is best-effort.
 */
export async function notifyMaintenanceTeam(workOrder, inspectionId, { source = "end-of-shift report" } = {}) {
  if (!workOrder?.maintenance_id) return;
  const { rows: recipients } = await query(
    `SELECT e.employee_id
       FROM employees e
       JOIN roles r ON r.role_id = e.role_id
      WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL AND e.role_id IS NOT NULL`,
    // The same audience the incident path pages for a routed work order
    // (admin + fleet_manager). Reused deliberately rather than added to the RBAC
    // matrix as a new "inspections" resource: the people who need to know about
    // a reported vehicle defect are the same people, and widening the
    // authorization matrix in order to route a notification is exactly the
    // conflation recipients.js warns against — "who MAY act" is not "who NEEDS
    // to know".
    [notificationRolesFor("incidents", "route_to_maintenance")]
  );
  if (!recipients.length) return;

  const isDriverReport = source === "end-of-shift report";
  // The office path must not claim a shift ended when it did not, and the
  // driver path must stay byte-identical to what it always said — so the two
  // are decided together rather than templating `source` straight into the
  // sentence, which would have read "a end-of-shift report" on every call the
  // driver path makes.
  const title = isDriverReport
    ? "End Duty Report Filed a Vehicle Repair"
    : "Failed Inspection Filed a Vehicle Repair";
  const described = isDriverReport ? "driver's end-of-shift report" : source;
  const grounded = workOrder.status === "In Progress";
  const message =
    `Work order #${workOrder.maintenance_id} was created from a ${described} ` +
    `(inspection #${inspectionId}) for vehicle #${workOrder.vehicle_id}. ` +
    (grounded
      ? "The vehicle is out of dispatch pending inspection."
      : "Filed for triage — the vehicle remains dispatchable until reviewed.");
  const inserted = [];
  for (const recipient of recipients) {
    const { rows } = await query(
      // $2/$5 carry explicit ::varchar casts, for the reason recorded on the
      // incident notifier: Postgres deduces SELECT-list parameters as text but
      // the NOT EXISTS comparison as varchar, and the 42P08 conflict fails the
      // whole statement at parse time. Without the casts this notifier would
      // fail silently on every call (the caller catches, best-effort).
      `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
       SELECT $1, $2::varchar, $3, $4, $5::varchar, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE employee_id = $1 AND title = $2::varchar
             AND reference_type = $5::varchar AND reference_id = $6
        )
       RETURNING employee_id`,
      [recipient.employee_id, title, message, "Alert", "maintenance", workOrder.maintenance_id]
    );
    if (rows[0]) inserted.push(recipient.employee_id);
  }
  if (inserted.length) {
    await sendPush({
      employeeIds: inserted,
      title,
      body: message,
      data: { reference_type: "maintenance", reference_id: workOrder.maintenance_id },
    });
  }
}

/**
 * Raise the work order for an End Duty report, best-effort.
 *
 * Never throws, deliberately: this is called from the path that ends a driver's
 * shift, and a maintenance failure must not strand them in the app at the end of
 * the day. The cost of that choice is real, and it is why this logs — the work
 * order IS the grounding, since GET /api/vehicles/available excludes a vehicle
 * by this row's status. So a failure here leaves a vehicle that the driver has
 * just reported a fault on still dispatchable. writeAppError is what stops that
 * being silent.
 */
export async function raiseEndDutyWorkOrder({ inspectionId, session, route = null }) {
  let result;
  try {
    result = await ensureInspectionMaintenance({ inspectionId, session });
  } catch (error) {
    void writeAppError({
      source: "server",
      route,
      message: `End Duty work order failed for inspection #${inspectionId}: ${error?.message || error}`,
      stack: error?.stack ?? null,
      statusCode: 500,
      employeeId: session?.user?.employeeId ?? null,
    });
    return { failed: true };
  }
  if (result.workOrder && result.created) {
    try {
      await notifyMaintenanceTeam(result.workOrder, inspectionId);
    } catch (error) {
      // Separate from the catch above on purpose: the work order exists, so
      // reporting this as "the work order failed" would be false. The vehicle
      // is grounded; only the announcement was lost.
      void writeAppError({
        source: "server",
        route,
        message: `End Duty work order notification failed for maintenance #${result.workOrder.maintenance_id}: ${error?.message || error}`,
        stack: error?.stack ?? null,
        statusCode: 500,
        employeeId: session?.user?.employeeId ?? null,
      });
    }
  }
  return result;
}
