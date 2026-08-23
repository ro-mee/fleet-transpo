import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { isSafeRemoteMediaUrl } from "@/lib/security/remote-url";
import {
  extractTextFromImage,
  parseDriverLicenseFieldsFromText,
  parseDriverLicenseBackFieldsFromText,
} from "@/lib/ai/license-ocr";

/**
 * POST /api/driver/license-scan
 *
 * Runs the same Tesseract OCR + regex parsers the staff scan endpoint uses
 * against a driver's own license scan, returning whether the AI could read the
 * key fields from the photo.
 *
 * Deliberately has NO LLM vision fallback and writes NOTHING to the database:
 * the endpoint only tells the driver UI whether the upload is readable. An
 * "unclear" result means the image is never saved, so a driver simply retakes
 * it until the scan reads clean — the DB never stores an unreadable scan.
 *
 * Body: { side: "front" | "back", file_url: <data URL or URL> }
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);

    const body = await parseBody(req);

    const errors = validateBody(body, {
      side: { required: true, type: "alphanumeric", label: "Side" },
      file_url: { required: true, label: "Scan image" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const side = String(body.side).toLowerCase();
    if (side !== "front" && side !== "back") {
      return err("side must be 'front' or 'back'", 400);
    }

    // SSRF guard: only inline data URLs or fleet-storage hosts may be fetched.
    if (!isSafeRemoteMediaUrl(body.file_url)) {
      return err("file_url must be the captured scan image.", 400);
    }

    const ocrText = await extractTextFromImage(body.file_url);

    const parsed =
      side === "back"
        ? parseDriverLicenseBackFieldsFromText(ocrText)
        : parseDriverLicenseFieldsFromText(ocrText);

    const extractedData = parsed.extractedData;
    const hasKeyFields =
      side === "back"
        ? Boolean(extractedData.emergency_contact_name || extractedData.emergency_contact_phone)
        : Boolean(extractedData.license_number || extractedData.last_name);

    return ok({
      side,
      ok: hasKeyFields,
      extracted_data: extractedData,
      confidence_scores: parsed.confidenceScores,
      validation_issues:
        hasKeyFields
          ? []
          : [
              "Could not read the license photo clearly. Please retake with better lighting and keep the card flat and in frame.",
            ],
      driver_id: session.user.driverId,
    });
  } catch (e) {
    return handleError(e);
  }
}
