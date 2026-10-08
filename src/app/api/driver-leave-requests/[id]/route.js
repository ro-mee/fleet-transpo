import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { reviewLeaveRequest } from "@/services/driver-schedule.service";

// Leave request review (migration 049). Admin and fleet_manager both review
// (admin gained `update` on 2026-10-03 so leave does not stall while the fleet
// manager is away); dispatcher and management only observe.
export async function PATCH(req, { params }) {
  try {
    const session = await requirePermission(req, "driver_leave_requests", "update");
    const id = (await params).id;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      status: { required: true, label: "Status" },
      notes: { maxLength: 500, label: "Review notes" },
    });
    if (!isValidObject(errors)) return errValidation(errors);
    if (!["Approved", "Declined"].includes(body.status)) {
      return err("status must be Approved or Declined.", 400);
    }

    const row = await reviewLeaveRequest(
      id,
      body.status,
      session.user?.employeeId ?? null,
      body.notes || null,
      { req, session }
    );
    return ok(row);
  } catch (e) { return handleError(e); }
}
