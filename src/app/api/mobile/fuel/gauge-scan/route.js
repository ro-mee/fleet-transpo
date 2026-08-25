import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { isOwnedFuelImageUrl } from "@/lib/fuel/receipt-storage";
import { scanFuelGaugeWithGemini } from "@/lib/fuel/gemini-gauge";

const MAX_GAUGE_BYTES = 10 * 1024 * 1024;

export async function POST(request) {
  try {
    const session = await requireDriver(request);
    const { gauge_url: gaugeUrl } = await parseBody(request);
    if (!isOwnedFuelImageUrl(gaugeUrl, session.user.driverId, "gauge")) {
      return err("The gauge photo is not a valid upload for this driver.", 400);
    }

    const imageResponse = await fetch(gaugeUrl);
    const contentType = imageResponse.headers.get("content-type")?.split(";")[0] || "";
    if (!imageResponse.ok || !contentType.startsWith("image/")) {
      return err("The uploaded gauge photo could not be read.", 400);
    }

    const fileBuffer = await imageResponse.arrayBuffer();
    if (fileBuffer.byteLength > MAX_GAUGE_BYTES) return err("Gauge photo must be 10 MB or smaller.", 400);

    try {
      const { extractedData, model } = await scanFuelGaugeWithGemini(fileBuffer, contentType);
      return ok({ extracted_data: extractedData, scan_engine: "gemini", model });
    } catch (error) {
      console.warn("Gemini gauge scan unavailable:", error.message);
      return err("Gemini gauge scan is unavailable. Enter the fuel level manually.", 503);
    }
  } catch (error) {
    return handleError(error, "Failed to scan fuel gauge");
  }
}
