import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function PATCH(req, { params }) {
  try {
    await requireAuth(req, ["admin", "system_admin", "fleet_manager"]);
    const id = Number(params.id);
    if (!Number.isInteger(id)) return err("Invalid card ID", 400);

    const body = await parseBody(req);
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (body.card_label !== undefined) {
      updates.push(`card_label = $${paramIdx++}`);
      values.push(body.card_label);
    }
    if (body.provider !== undefined) {
      updates.push(`provider = $${paramIdx++}`);
      values.push(body.provider);
    }
    if (body.status !== undefined) {
      if (!['Active', 'Suspended', 'Cancelled'].includes(body.status)) {
        return err("Invalid status", 400);
      }
      updates.push(`status = $${paramIdx++}`);
      values.push(body.status);
    }
    if (body.monthly_limit !== undefined) {
      updates.push(`monthly_limit = $${paramIdx++}`);
      values.push(body.monthly_limit ? Number(body.monthly_limit) : null);
    }

    if (updates.length === 0) return err("No updates provided", 400);

    updates.push(`updated_at = NOW()`);
    
    const { rows } = await query(
      `UPDATE company_cards SET ${updates.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
      [...values, id]
    );

    if (!rows[0]) return err("Card not found", 404);
    
    return ok(rows[0]);
  } catch (error) {
    return handleError(error, "Failed to update company card");
  }
}
