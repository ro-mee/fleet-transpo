import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { getExpenseReceiptSignedUrl } from "@/lib/expenses/receipt-storage";

export async function GET(req, { params }) {
  try {
    // Only authorized roles can view expense receipts
    await requireAuth(req, ["admin", "system_admin", "fleet_manager", "management"]);
    const id = Number(params.id);
    if (!Number.isInteger(id)) return err("Invalid expense ID", 400);

    const { rows } = await query(
      `SELECT receipt_storage_key FROM expense_records WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!rows[0]) {
      return err("Expense not found", 404);
    }

    const url = await getExpenseReceiptSignedUrl(rows[0].receipt_storage_key);
    return ok({ url });
  } catch (error) {
    return handleError(error, "Failed to get receipt URL");
  }
}
