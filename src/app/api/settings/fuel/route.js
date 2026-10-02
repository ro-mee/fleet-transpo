import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { getFuelPolicy, saveFuelPolicy } from "@/services/fuel-settings.service";
import { mergeFuelPolicy, validateFuelPolicy } from "@/lib/fuel/fuel-policy";
import { writeAudit } from "@/lib/audit";

const ALLOWED_KEYS = new Set([
  "reserveBufferPercent",
  "preferredTargetPercent",
  "maxFillCapPercent",
  "varianceThresholdPercent",
  "enableVarianceAlerts",
  "autoApprovalEnabled",
  "autoApprovalMaxLiters",
  "budgetEnforcementMode",
  "maxPricePerLiter",
  "strictFuelTypeMatching",
]);

export async function GET(req) {
  try {
    await requirePermission(req, "fuel_settings", "read");
    return ok(await getFuelPolicy());
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requirePermission(req, "fuel_settings", "update");
    const body = await parseBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return err("Policy must be an object", 400);

    const candidate = { ...body };
    for (const key of Object.keys(candidate)) {
      if (!ALLOWED_KEYS.has(key)) delete candidate[key];
    }
    if (!Object.keys(candidate).length) return err("No fuel policy fields provided", 400);

    const before = await getFuelPolicy();
    const check = validateFuelPolicy({ ...before, ...candidate });
    if (!check.ok) return err(check.error, 400);

    const policy = mergeFuelPolicy({ ...before, ...candidate });
    const saved = await saveFuelPolicy(policy, session.user?.employeeId ?? null);

    await writeAudit(req, session, {
      action: "update",
      resource: "fuel_policy",
      oldValues: before,
      newValues: saved,
    });

    return ok(saved);
  } catch (e) {
    return handleError(e);
  }
}
