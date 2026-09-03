import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req, { params }) {
  try {
    await requireAuth(req, ["admin", "system_admin", "fleet_manager"]);
    const id = Number(params.id);
    if (!Number.isInteger(id)) return err("Invalid card ID", 400);

    const { rows } = await query(`
      SELECT a.*,
             row_to_json(e.*) as employee,
             row_to_json(v.*) as vehicle,
             row_to_json(assigner.*) as assigned_by_employee
      FROM company_card_assignments a
      LEFT JOIN employees e ON e.employee_id = a.employee_id
      LEFT JOIN vehicles v ON v.vehicle_id = a.vehicle_id
      LEFT JOIN employees assigner ON assigner.employee_id = a.assigned_by
      WHERE a.company_card_id = $1
      ORDER BY a.assigned_at DESC
    `, [id]);
    
    return ok({ rows });
  } catch (error) {
    return handleError(error, "Failed to get assignment history");
  }
}

export async function POST(req, { params }) {
  try {
    const session = await requireAuth(req, ["admin", "system_admin", "fleet_manager"]);
    const id = Number(params.id);
    if (!Number.isInteger(id)) return err("Invalid card ID", 400);

    const body = await parseBody(req);
    const employeeId = body.employee_id ? Number(body.employee_id) : null;
    const vehicleId = body.vehicle_id ? Number(body.vehicle_id) : null;
    
    if (!employeeId && !vehicleId && body.assignment_type !== 'Shared') {
      // It doesn't strictly need one according to the prompt (XOR not required),
      // but usually an assignment points somewhere. 
      // If Shared/Unassigned is allowed, we accept it.
    }

    const record = await withTransaction(async (tx) => {
      // 1. Lock the card
      const { rows: cards } = await tx.query(`SELECT id FROM company_cards WHERE id = $1 FOR UPDATE`, [id]);
      if (!cards[0]) throw Object.assign(new Error("Card not found"), { status: 404 });

      // Close previous assignment
      await tx.query(
        `UPDATE company_card_assignments 
         SET unassigned_at = NOW() 
         WHERE company_card_id = $1 AND unassigned_at IS NULL`,
        [id]
      );

      // Create new assignment
      const { rows } = await tx.query(
        `INSERT INTO company_card_assignments 
         (company_card_id, employee_id, vehicle_id, assigned_by, assignment_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, employeeId, vehicleId, session.user.employeeId, body.assignment_type || null]
      );
      
      return rows[0];
    });

    return ok(record, 201);
  } catch (error) {
    return handleError(error, "Failed to assign company card");
  }
}
