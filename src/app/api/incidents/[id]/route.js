import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

export async function PATCH(req, props) {
  try {
    // Only staff can resolve incidents
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const body = await parseBody(req);
    const errors = validateBody(body, {
      status: { required: true, maxLength: 50, label: "Status" },
      actions_taken: { maxLength: 2000, label: "Actions Taken" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const { rows } = await query(
      `UPDATE driverincidents
          SET status = $1,
              actions_taken = $2
        WHERE incident_id = $3 AND deleted_at IS NULL
        RETURNING incident_id, status, actions_taken`,
      [body.status, body.actions_taken || null, id]
    );

    if (rows.length === 0) return err("Incident not found", 404);

    return ok(rows[0]);
  } catch (e) {
    return handleError(e);
  }
}
