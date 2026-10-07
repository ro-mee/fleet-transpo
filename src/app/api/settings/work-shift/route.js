import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { getWorkShiftPolicy, saveWorkShiftPolicy } from "@/services/work-shift-policy.service";
import { validateWorkShiftPolicy } from "@/lib/work-shift-policy";
import { writeAudit } from "@/lib/audit";

export async function GET(req) {
  try {
    await requirePermission(req, "dispatch_settings", "read");
    return ok(await getWorkShiftPolicy());
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requirePermission(req, "dispatch_settings", "update");
    const body = await parseBody(req);

    const check = validateWorkShiftPolicy(body);
    if (!check.ok) {
      return err(check.error, 400);
    }

    const before = await getWorkShiftPolicy();
    const saved = await saveWorkShiftPolicy(body, session.user?.employeeId ?? null);

    await writeAudit(req, session, {
      action: "update",
      resource: "work_shift_policy",
      oldValues: before,
      newValues: saved,
    });

    return ok(saved);
  } catch (e) {
    return handleError(e);
  }
}
