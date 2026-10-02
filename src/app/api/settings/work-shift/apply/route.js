import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { applyWorkShiftPolicyToDrivers } from "@/services/work-shift-policy.service";
import { writeAudit } from "@/lib/audit";

export async function POST(req) {
  try {
    const session = await requirePermission(req, "dispatch_settings", "update");
    const body = await parseBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return err("An object payload is required", 400);
    if (body?.driver_ids !== undefined && (
      !Array.isArray(body.driver_ids) || body.driver_ids.length === 0 ||
      body.driver_ids.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)
    )) return err("driver_ids must be a nonempty array of driver IDs", 400);
    if (body.stagger_breaks !== undefined && typeof body.stagger_breaks !== "boolean") return err("stagger_breaks must be a boolean", 400);
    if (body.stagger_rest_days !== undefined && typeof body.stagger_rest_days !== "boolean") return err("stagger_rest_days must be a boolean", 400);

    const result = await applyWorkShiftPolicyToDrivers({
      driverIds: body?.driver_ids,
      staggerBreaks: body?.stagger_breaks,
      staggerRestDays: body?.stagger_rest_days,
      actorId: session.user?.employeeId ?? null,
    });

    await writeAudit(req, session, {
      action: "apply",
      resource: "driver_work_schedules",
      details: {
        count: result.updatedCount,
        driverIds: result.driverIds,
        staggerBreaks: result.staggerBreaks,
        staggerRestDays: result.staggerRestDays,
      },
    });

    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}
