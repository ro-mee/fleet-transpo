import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { getDispatchPolicy, saveDispatchPolicy } from "@/services/dispatch-settings.service";
import { mergeDispatchPolicy, validateDispatchPolicy } from "@/lib/dispatch-policy";
import { writeAudit } from "@/lib/audit";

const ALLOWED_KEYS = new Set([
  "criticalMinutes",
  "highMinutes",
  "mediumMinutes",
  "enableVipFlag",
  "enableEmergencyFlag",
]);

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    return ok(await getDispatchPolicy());
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin"]);
    const body = await parseBody(req);

    const candidate = { ...body };
    for (const key of Object.keys(candidate)) {
      if (!ALLOWED_KEYS.has(key)) delete candidate[key];
    }

    const check = validateDispatchPolicy(candidate);
    if (!check.ok) return err(check.error, 400);

    const policy = mergeDispatchPolicy(candidate);
    const saved = await saveDispatchPolicy(policy, session.user?.employeeId ?? null);

    await writeAudit(req, session, {
      action: "update",
      resource: "dispatch_policy",
      oldValues: policy,
      newValues: saved,
    });

    return ok(saved);
  } catch (e) {
    return handleError(e);
  }
}
