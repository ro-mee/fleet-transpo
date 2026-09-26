import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { ensureInspectionMaintenance, notifyMaintenanceTeam } from "@/lib/inspections/maintenance";

// Raise the repair ticket for a problem-queue row.
//
// This is the office-side half of the inspect -> maintenance bridge. Until it
// existed, source_inspection_id could only ever be written by the driver's own
// End Duty submission (raiseEndDutyWorkOrder in lib/inspections/maintenance.js),
// so a report whose best-effort raise failed was unresolvable from any UI — the
// queue could show it and never clear it.
//
// Authorization is maintenance:create, matching the /maintenance page that hosts
// this action. No new RBAC resource (see the note in lib/inspections/maintenance.js
// about recipients vs. authorization — that one is about notifications, and this
// is about an action, so it is not the same decision).
//
// Unlike the driver path this THROWS on failure instead of swallowing: a manager
// who clicked a button is owed the truth, and the failure to swallow is the
// notification, not the work order.

export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "maintenance", "create");

    const { inspectionId: raw } = await params;
    const inspectionId = Number.parseInt(raw, 10);
    if (!Number.isInteger(inspectionId) || inspectionId <= 0) {
      return err("inspectionId must be a positive integer", 400);
    }

    // allowChecklistType is the flag that lets a failed Pre-Shift / Pre-Trip
    // through — it is what makes the earlier "only an End Duty report raises a
    // work order" boundary true of the automatic path and false of a person's
    // request. This route is the only caller that sets it.
    const result = await ensureInspectionMaintenance({ inspectionId, session, allowChecklistType: true });

    if (result.notFound) return err("Inspection not found", 404);
    if (result.notRequired) {
      // Unreachable while the flag above is passed — the module refuses a
      // checklist type only when it is false. Kept so a future refusal reason
      // cannot be reported to the user as success.
      return err("The work-order flow refused this inspection — this should not happen from the office queue", 500);
    }
    if (result.notReported) {
      return err("That inspection records no defect to raise", 400);
    }

    if (result.created) {
      // Derived from the record rather than assumed: this route raises work
      // orders for a failed checklist as well as for an End Duty report, and
      // the announcement must not call one the other.
      const source = result.inspection?.inspection_type === "Post-Shift"
        ? "end-of-shift report"
        : `failed ${result.inspection?.inspection_type ?? "checklist"} inspection`;
      try {
        await notifyMaintenanceTeam(result.workOrder, inspectionId, { source });
      } catch (error) {
        // The work order exists. Saying "could not create the work order" here
        // would be false, so name the real half. Note that a checklist raise
        // leaves the vehicle dispatchable, so this is not a grounding failure.
        return err(`Work order #${result.workOrder.maintenance_id} was created, but notifying the maintenance team failed`, 500);
      }
    }

    return ok({ workOrder: result.workOrder, created: result.created }, result.created ? 201 : 200);
  } catch (error) {
    return handleError(error);
  }
}
