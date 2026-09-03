import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req, ["admin", "system_admin", "fleet_manager"]);
    
    // Get all cards with their current active assignment
    const { rows } = await query(`
      SELECT c.*,
             a.id as assignment_id, a.assigned_at, a.assignment_type,
             row_to_json(e.*) as employee,
             row_to_json(v.*) as vehicle
      FROM company_cards c
      LEFT JOIN company_card_assignments a ON a.company_card_id = c.id AND a.unassigned_at IS NULL
      LEFT JOIN employees e ON e.employee_id = a.employee_id
      LEFT JOIN vehicles v ON v.vehicle_id = a.vehicle_id
      ORDER BY c.created_at DESC
    `);
    return ok({ rows });
  } catch (error) {
    return handleError(error, "Failed to get company cards");
  }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["admin", "system_admin", "fleet_manager"]);
    const body = await parseBody(req);
    
    if (!body.card_last_four || body.card_last_four.length !== 4) {
      return err("card_last_four must be exactly 4 characters", 400);
    }

    const { rows } = await query(
      `INSERT INTO company_cards (card_label, card_last_four, provider, status, monthly_limit)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        body.card_label || null,
        body.card_last_four,
        body.provider || null,
        body.status || 'Active',
        body.monthly_limit ? Number(body.monthly_limit) : null
      ]
    );

    return ok(rows[0], 201);
  } catch (error) {
    return handleError(error, "Failed to create company card");
  }
}
