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
      const { receiptUrl, receiptPath } = await storeFuelReceipt(file, session.user.driverId, folder);
      // Both shapes are returned for one release. `_url` is short-lived and is
      // what current APKs preview and send to the scan endpoint; `_path` is the
      // value that belongs in the record. The submit endpoints accept either and
      // canonicalise the URL back to its key, so an already-installed client
      // that only knows `_url` still stores a key — the app update is not
      // required for the column to be right.
      return ok({ [`${kind}_url`]: receiptUrl, [`${kind}_path`]: receiptPath }, 201);
    } catch (error) {
      return err(error.message || "Failed to upload image.", 400);
    }
  } catch (error) {
    return handleError(error, "Failed to upload fuel image");
  }
}
