import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { listLeaveRequests, createLeaveRequest } from "@/services/driver-schedule.service";

// Driver leave self-service (migration 049).
//
// GET lists the signed-in driver's own requests. POST files a new request; it
// stays Pending until the fleet manager approves or declines it. Only approved
// requests block assignment. A driver can withdraw a pending request by DELETE.
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const rows = await listLeaveRequests(session.user.driverId);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const driverId = session.user.driverId;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      start_date: { required: true, type: "date", label: "Start date" },
      end_date: { required: true, type: "date", label: "End date" },
      leave_type: { maxLength: 50, label: "Leave type" },
      reason: { maxLength: 500, label: "Reason" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    if (body.end_date < body.start_date) {
      return err("End date must be on or after the start date.", 400);
    }
    if (body.start_date < new Date().toISOString().slice(0, 10)) {
      return err("A leave request cannot start in the past.", 400);
    }

    const row = await createLeaveRequest(driverId, {
      start_date: body.start_date,
      end_date: body.end_date,
      leave_type: body.leave_type,
      reason: body.reason,
    });
    return ok(row, 201);
  } catch (e) { return handleError(e); }
}

// Withdraw a Pending request the driver filed themselves. Approved or declined
// requests are final — they are audited decisions.
export async function DELETE(req) {
  try {
    const session = await requireDriver(req);
    const sp = new URL(req.url).searchParams;
    const id = Number(sp.get("leave_request_id"));
    if (!Number.isInteger(id) || id <= 0) return err("leave_request_id is required", 400);

    const { rows } = await query(
      `DELETE FROM driver_leave_requests
        WHERE leave_request_id = $1 AND driver_id = $2 AND status = 'Pending'
        RETURNING *`,
      [id, session.user.driverId]
    );
    if (!rows[0]) return err("Leave request not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}