import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { listViolations, listPendingApprovals } from "@/lib/uvvrp/uvvrp.service";

export async function GET(req) {
  try {
    await requirePermission(req, "uvvrp", "read");
    const sp = new URL(req.url).searchParams;
    const onlyPending = sp.get("status") === "pending_approval";
    const rows = onlyPending ? await listPendingApprovals() : await listViolations({ limit: sp.get("limit") });
    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
