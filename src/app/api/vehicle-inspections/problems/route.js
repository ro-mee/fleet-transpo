import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { listVehicleProblems, countProblemCounts, PROBLEM_QUEUE_LIMIT } from "@/lib/inspections/problem-queue";

// The office's vehicle problem queue. Read-only; resolving a row is
// POST /api/vehicle-inspections/[inspectionId]/work-order.
//
// Authorized as maintenance:read rather than as a new `inspections` resource —
// rolesFor("maintenance", "read") is already super_admin + admin +
// fleet_manager, the same three roles NAV_ROLES already gates /maintenance with,
// so this needs no change to permissions.js.
//
// scope=count exists so the role dashboard's attention strip can show an exact
// figure without pulling a page of rows on every dashboard load.

const MAX_LIMIT = PROBLEM_QUEUE_LIMIT;

function boundedInt(raw, fallback, { min = 0, max } = {}) {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}

export async function GET(req) {
  try {
    await requirePermission(req, "maintenance", "read");

    const params = new URL(req.url).searchParams;
    if (params.get("scope") === "count") {
      return ok({ counts: await countProblemCounts() });
    }

    const limit = boundedInt(params.get("limit"), MAX_LIMIT, { min: 1, max: MAX_LIMIT });
    const offset = boundedInt(params.get("offset"), 0, { min: 0 });
    return ok(await listVehicleProblems({ limit, offset }));
  } catch (error) {
    return handleError(error);
  }
}
