import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { storeFuelReceipt } from "@/lib/fuel/receipt-storage";

const UPLOAD_KINDS = new Map([
  ["receipt", ""],
  ["gauge", "gauge"],
]);

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const formData = await req.formData();
    const kind = String(formData.get("kind") || "receipt").toLowerCase();
    const folder = UPLOAD_KINDS.get(kind);
    if (folder === undefined) return err("Unknown image kind", 400);

    // Current APKs send the file as "receipt"; newer clients may send "image".
    const file = formData.get(kind) || formData.get("receipt") || formData.get("image");

    try {
      const { receiptUrl } = await storeFuelReceipt(file, session.user.driverId, folder);
      return ok({ [`${kind}_url`]: receiptUrl }, 201);
    } catch (error) {
      return err(error.message || "Failed to upload image.", 400);
    }
  } catch (error) {
    return handleError(error, "Failed to upload fuel image");
  }
}
