import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { listViolations, listPendingApprovals } from "@/lib/uvvrp/uvvrp.service";

export async function GET(req) {
  try {
    await requireAuth(req, ["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);
    const sp = new URL(req.url).searchParams;
    const onlyPending = sp.get("status") === "pending_approval";
    const rows = onlyPending ? await listPendingApprovals() : await listViolations({ limit: sp.get("limit") });
    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
