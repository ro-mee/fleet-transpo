import { withTransaction } from "@/lib/db";
import { AuthError, requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { writeAuditRequired } from "@/lib/audit";

export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "expenses", "review");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return err("Invalid expense ID", 400);

    const body = await parseBody(req);
    const { action, review_remarks } = body;

    if (action !== "Approve" && action !== "Reject") {
      return err("Action must be either 'Approve' or 'Reject'", 400);
    }
    
    if (action === "Reject" && (!review_remarks || !review_remarks.trim())) {
      return err("review_remarks are required when rejecting an expense", 400);
    }

    const newStatus = action === "Approve" ? "Approved" : "Rejected";
    const row = await withTransaction(async (tx) => {
      const { rows: expenses } = await tx.query(
        `SELECT status FROM expense_records WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!expenses[0]) throw new AuthError("Expense not found", 404);
      const currentStatus = expenses[0].status;
      if (currentStatus !== "Pending") throw new AuthError(`Cannot review an expense that is already ${currentStatus}`, 409);

      const { rows } = await tx.query(
        `UPDATE expense_records
            SET status = $1,
                review_remarks = $2,
                reviewed_by = $3,
                reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = $4 AND status = 'Pending'
          RETURNING *`,
        [newStatus, review_remarks?.trim() || null, session.user.employeeId, id]
      );
      if (!rows[0]) throw new AuthError("Expense has already been reviewed", 409);
      await writeAuditRequired(tx, req, session, {
        action: "expense_reviewed",
        resource: "expense_records",
        resourceId: id,
        oldValues: { status: currentStatus },
        newValues: { decision: action === "Approve" ? "approve" : "reject", status: newStatus, outcome: "completed" },
      });
      return rows[0];
    });

    return ok(row);
  } catch (error) {
    return handleError(error, "Failed to review expense");
  }
}
