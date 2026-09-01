import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { decideViolation } from "@/lib/uvvrp/uvvrp.service";
import { writeAudit } from "@/lib/audit";

// Approve/deny a pending coding approval. On approve, the approved violation
// covers that vehicle+date so the dispatcher's retry passes.
export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "uvvrp", "decide");
    const { id } = await params;
    const body = await parseBody(req).catch(() => ({}));

    const approve = body?.approve === true;
    const row = await decideViolation(id, {
      approve,
      reason: body?.reason ? String(body.reason).slice(0, 1000) : null,
      decidedBy: session.user?.employeeId ?? null,
    });
    if (!row) return err("Violation not found", 404);

    await writeAudit(req, session, {
      action: "update",
      resource: "uvvrp_violation",
      resourceId: row.violation_id,
      newValues: row,
    });

    return ok(row);
  } catch (e) {
    return handleError(e);
  }
}
