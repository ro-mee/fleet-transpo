import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { setExemptionActive } from "@/lib/uvvrp/uvvrp.service";
import { writeAudit } from "@/lib/audit";

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["admin", "system_admin", "fleet_manager"]);
    const { id } = await params;
    const body = await parseBody(req).catch(() => ({}));

    const row = await setExemptionActive(id, {
      active: body.active !== false,
      expiresOn: body.expires_on || null,
      actorId: session.user?.employeeId ?? null,
    });
    if (!row) return err("Exemption not found", 404);

    await writeAudit(req, session, {
      action: "update",
      resource: "uvvrp_exemption",
      resourceId: row.exemption_id,
      newValues: row,
    });

    return ok(row);
  } catch (e) {
    return handleError(e);
  }
}
