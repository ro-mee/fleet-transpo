import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { listAllLeaveRequests } from "@/services/driver-schedule.service";

// Leave review feed for staff (migration 049).
//
// Lists every driver's leave requests, newest first. The fleet manager
// approves/declines via PATCH /api/driver-leave-requests/[id]; this read is open
// to the staff roles that need to see who is away when planning dispatches.
export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const sp = new URL(req.url).searchParams;
    const driverId = sp.get("driver_id") ? Number(sp.get("driver_id")) : undefined;
    const rows = await listAllLeaveRequests({ driverId });
    return ok(rows);
  } catch (e) { return handleError(e); }
}