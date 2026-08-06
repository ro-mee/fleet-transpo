import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { getUvvrpPolicy, saveUvvrpPolicy } from "@/lib/uvvrp/uvvrp.service";
import { mergePolicy } from "@/lib/uvvrp/policy";
import { writeAudit } from "@/lib/audit";

const ALLOWED_KEYS = new Set([
  "enabled",
  "location",
  "weekdayRestrictions",
  "response",
  "exemptionCategories",
]);

export async function GET(req) {
  try {
    await requireAuth(req, ["admin", "system_admin"]);
    return ok(await getUvvrpPolicy());
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requireAuth(req, ["admin", "system_admin"]);
    const body = await parseBody(req);

    const candidate = { ...body };
    for (const key of Object.keys(candidate)) {
      if (!ALLOWED_KEYS.has(key)) delete candidate[key];
    }
    if (!["block", "warn", "approve"].includes(candidate.response)) {
      return err("response must be one of block | warn | approve", 400);
    }
    candidate.enabled = candidate.enabled === true;

    const policy = mergePolicy(candidate);
    const saved = await saveUvvrpPolicy(policy, session.user?.employeeId ?? null);

    await writeAudit(req, session, {
      action: "update",
      resource: "uvvrp_policy",
      oldValues: { ...policy, weekdayRestrictions: undefined },
      newValues: { ...saved, weekdayRestrictions: undefined },
    });

    return ok(saved);
  } catch (e) {
    return handleError(e);
  }
}
