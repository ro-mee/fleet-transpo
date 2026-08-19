import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { storeFuelReceipt } from "@/lib/fuel/receipt-storage";

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const formData = await req.formData();
    const file = formData.get("receipt");

    try {
      const { receiptUrl } = await storeFuelReceipt(file, session.user.driverId);
      return ok({ receipt_url: receiptUrl }, 201);
    } catch (error) {
      return err(error.message || "Failed to upload receipt image.", 400);
    }
  } catch (error) {
    return handleError(error, "Failed to upload fuel receipt");
  }
}
