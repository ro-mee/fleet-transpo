import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { storeExpenseReceipt } from "@/lib/expenses/receipt-storage";
import { query } from "@/lib/db";

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const formData = await req.formData();
    const file = formData.get("receipt") || formData.get("image");
    
    // Idempotency key from client to isolate folders
    const clientSubmissionId = formData.get("client_submission_id");

    if (!file) {
      return err("No receipt image provided", 400);
    }
    if (!clientSubmissionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientSubmissionId)) {
      return err("client_submission_id must be a valid UUID", 400);
    }

    try {
      const result = await storeExpenseReceipt(file, session.user.driverId, clientSubmissionId);
      
      // F-01 & F-02: Establish server-side ownership and trust boundary for the receipt scan
      await query(
        `INSERT INTO expense_receipt_scans (client_submission_id, driver_id, receipt_storage_key, receipt_sha256)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_submission_id) DO UPDATE SET
           driver_id = EXCLUDED.driver_id,
           receipt_storage_key = EXCLUDED.receipt_storage_key,
           receipt_sha256 = EXCLUDED.receipt_sha256,
           updated_at = NOW()`,
        [clientSubmissionId, session.user.driverId, result.receipt_storage_key, result.receipt_sha256]
      );

      return ok({
        receipt_storage_key: result.receipt_storage_key,
        receipt_sha256: result.receipt_sha256
      }, 201);
    } catch (error) {
      return err(error.message || "Failed to upload image.", 400);
    }
  } catch (error) {
    return handleError(error, "Failed to upload expense receipt");
  }
}
