import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { scanExpenseReceiptWithGemini } from "@/lib/expenses/gemini-expense-receipt";

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export async function POST(request) {
  try {
    const session = await requireDriver(request);
    const { client_submission_id: clientSubmissionId } = await parseBody(request);
    
    if (!clientSubmissionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientSubmissionId)) {
      return err("client_submission_id must be a valid UUID", 400);
    }
    
    const { rows: scans } = await query(
      `SELECT * FROM expense_receipt_scans WHERE client_submission_id = $1 LIMIT 1`,
      [clientSubmissionId]
    );

    const scanRecord = scans[0];
    if (!scanRecord) {
      return err("Receipt upload not found", 404);
    }
    if (scanRecord.driver_id !== session.user.driverId) {
      return err("This receipt belongs to another driver", 403);
    }
    if (scanRecord.is_submitted) {
      return err("This receipt has already been submitted", 409);
    }

    const storageKey = scanRecord.receipt_storage_key;

    const supabase = createAdminClient();
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("expense-receipts")
      .download(storageKey);

    if (downloadError || !fileBlob) {
      return err("The uploaded receipt image could not be read.", 400);
    }

    const fileBuffer = await fileBlob.arrayBuffer();
    if (fileBuffer.byteLength > MAX_RECEIPT_BYTES) {
      return err("Receipt image must be 10 MB or smaller.", 400);
    }

    const contentType = fileBlob.type || "image/jpeg";

    try {
      const { extractedData, model } = await scanExpenseReceiptWithGemini(fileBuffer, contentType);
      
      await query(
        `UPDATE expense_receipt_scans 
         SET ocr_snapshot = $1, updated_at = NOW() 
         WHERE client_submission_id = $2`,
        [JSON.stringify(extractedData), clientSubmissionId]
      );
      
      return ok({ extracted_data: extractedData, scan_engine: "gemini", model });
    } catch (error) {
      console.warn("Gemini expense receipt scan unavailable:", error.message);
      return err("Gemini receipt scan is unavailable. Enter the receipt details manually.", 503);
    }
  } catch (error) {
    return handleError(error, "Failed to scan expense receipt");
  }
}
