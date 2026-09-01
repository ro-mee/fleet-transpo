import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { getDispatchPolicy, saveDispatchPolicy } from "@/services/dispatch-settings.service";
import { mergeDispatchPolicy, validateDispatchPolicy } from "@/lib/dispatch-policy";
import { writeAudit } from "@/lib/audit";

const ALLOWED_KEYS = new Set([
  "criticalMinutes",
  "highMinutes",
  "mediumMinutes",
  "enableVipFlag",
  "enableEmergencyFlag",
  "departureAlertsEnabled",
  "departureAlertTiers",
]);

export async function GET(req) {
  try {
    // Dispatchers read this but cannot write it: the departure-alert tiers are
    // consumed by their board, so excluding them here would silently fall the
    // warnings back to defaults for exactly the role that acts on them.
    await requirePermission(req, "dispatch_settings", "read");
    return ok(await getDispatchPolicy());
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requirePermission(req, "dispatch_settings", "update");
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
