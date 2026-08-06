import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { listExemptions, createExemption } from "@/lib/uvvrp/uvvrp.service";
import { writeAudit } from "@/lib/audit";

export async function GET(req) {
  try {
    await requireAuth(req, ["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);
    return ok(await listExemptions());
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req) {
  try {
    const session = await requireAuth(req, ["admin", "system_admin", "fleet_manager"]);
    const body = await parseBody(req);
    const vehicleId = Number(body.vehicle_id);
    const category = String(body.category || "").trim();
    if (!vehicleId || !category) return err("vehicle_id and category are required", 400);

    const row = await createExemption({
      vehicleId,
      category: category.slice(0, 100),
      reason: body.reason ? String(body.reason).slice(0, 1000) : null,
      expiresOn: body.expires_on || null,
      approvedBy: session.user?.employeeId ?? null,
    });

    await writeAudit(req, session, {
      action: "create",
      resource: "uvvrp_exemption",
      resourceId: row?.exemption_id,
      newValues: row,
    });

    return ok(row, 201);
  } catch (e) {
    return handleError(e);
  }
}
