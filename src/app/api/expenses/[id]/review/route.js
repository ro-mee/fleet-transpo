import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "expenses", "review");
    const id = Number(params.id);
    if (!Number.isInteger(id)) return err("Invalid expense ID", 400);

    const body = await parseBody(req);
    const { action, review_remarks } = body;

    if (action !== "Approve" && action !== "Reject") {
      return err("Action must be either 'Approve' or 'Reject'", 400);
    }
    
    if (action === "Reject" && (!review_remarks || !review_remarks.trim())) {
      return err("review_remarks are required when rejecting an expense", 400);
    }

    // Load the expense server-side
    const { rows: expenses } = await query(
      `SELECT status FROM expense_records WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (!expenses[0]) {
      return err("Expense not found", 404);
    }

    const currentStatus = expenses[0].status;
    if (currentStatus !== "Pending") {
      return err(`Cannot review an expense that is already ${currentStatus}`, 409);
    }

    const newStatus = action === "Approve" ? "Approved" : "Rejected";

    const { rows } = await query(
      `UPDATE expense_records
          SET status = $1,
              review_remarks = $2,
              reviewed_by = $3,
              reviewed_at = NOW(),
              updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [newStatus, review_remarks?.trim() || null, session.user.employeeId, id]
    );

    return ok(rows[0]);
  } catch (error) {
    return handleError(error, "Failed to review expense");
  }
}
