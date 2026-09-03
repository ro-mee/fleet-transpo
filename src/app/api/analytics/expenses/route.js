import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req, ["admin", "system_admin", "fleet_manager", "management"]);
    
    // Core Financial Invariant: Only 'Approved' enters analytics
    // Reporting boundary: 'Asia/Manila'

    const { rows: monthlyExpenses } = await query(`
      SELECT 
        to_char(expense_date AT TIME ZONE 'Asia/Manila', 'YYYY-MM') as month,
        category,
        SUM(amount) as total_amount
      FROM expense_records
      WHERE status = 'Approved'
      GROUP BY to_char(expense_date AT TIME ZONE 'Asia/Manila', 'YYYY-MM'), category
      ORDER BY month DESC
    `);

    const { rows: totals } = await query(`
      SELECT 
        SUM(amount) as total_approved_expenses
      FROM expense_records
      WHERE status = 'Approved'
    `);

    return ok({ 
      monthly_breakdown: monthlyExpenses,
      total_approved: Number(totals[0].total_approved_expenses || 0)
    });
  } catch (error) {
    return handleError(error, "Failed to fetch expense analytics");
  }
}
