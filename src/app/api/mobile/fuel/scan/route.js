import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { isOwnedFuelReceiptUrl } from "@/lib/fuel/receipt-storage";
import { scanFuelReceiptWithGemini } from "@/lib/fuel/gemini-receipt";

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export async function POST(request) {
  try {
    const session = await requireDriver(request);
    const { receipt_url: receiptUrl } = await parseBody(request);
    if (!isOwnedFuelReceiptUrl(receiptUrl, session.user.driverId)) {
      return err("The receipt photo is not a valid upload for this driver.", 400);
    }

    const imageResponse = await fetch(receiptUrl);
    const contentType = imageResponse.headers.get("content-type")?.split(";")[0] || "";
    if (!imageResponse.ok || !contentType.startsWith("image/")) {
      return err("The uploaded receipt image could not be read.", 400);
    }

    const fileBuffer = await imageResponse.arrayBuffer();
    if (fileBuffer.byteLength > MAX_RECEIPT_BYTES) return err("Receipt image must be 10 MB or smaller.", 400);

    try {
      const { extractedData, model } = await scanFuelReceiptWithGemini(fileBuffer, contentType);
      return ok({ extracted_data: extractedData, scan_engine: "gemini", model });
    } catch (error) {
      console.warn("Gemini fuel receipt scan unavailable:", error.message);
      return err("Gemini receipt scan is unavailable. Enter the receipt details manually.", 503);
    }
  } catch (error) {
    return handleError(error, "Failed to scan fuel receipt");
  }
}
