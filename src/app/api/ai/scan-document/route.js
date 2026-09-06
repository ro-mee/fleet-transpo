import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { logAiRequest } from "@/lib/ai/logger";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";
import { isSafeRemoteMediaUrl } from "@/lib/security/remote-url";
import { loadScanImage, scanDocumentWithGemini } from "@/lib/ai/gemini-document";

const SUPPORTED_DOCUMENT_TYPES = new Set([
  "Driver_License",
  "Driver_License_Back",
  "OR_CR",
  "Insurance",
]);

export async function POST(request) {
  try {
    await requirePermission(request, "ai", "scan_document");

    const body = await parseBody(request);
    const { document_type: documentType, file_url: fileUrl } = body || {};

    if (!SUPPORTED_DOCUMENT_TYPES.has(documentType)) {
      return err("Document type is required (Driver_License, Driver_License_Back, OR_CR, Insurance)", 400);
    }

    if (!fileUrl || typeof fileUrl !== "string") {
      return err("A scanned document image (file_url) is required.", 400);
    }

    // SSRF guard: the server must never fetch arbitrary caller-supplied URLs,
    // only fleet storage or inline data URLs.
    if (!isSafeRemoteMediaUrl(fileUrl)) {
      return err("file_url must be a document uploaded to fleet storage.", 400);
    }

    let extractedData = {};
    let model = null;
    const validationIssues = [];

    try {
      const { buffer, contentType } = await loadScanImage(fileUrl);
      const { extractedData: scanned, model: usedModel } = await scanDocumentWithGemini(
        buffer,
        contentType,
        documentType
      );
      extractedData = Object.fromEntries(
        Object.entries(scanned).filter(([, value]) => value !== null && value !== "")
      );
      model = usedModel;
    } catch (scanError) {
      console.warn("Gemini document scan unavailable:", scanError.message);
      // AI-owned failure: persist to ailogs (not app_errors). The logger is
      // best-effort and never throws, so this cannot break the fallback below.
      // No subsystemOwned marker needed — nothing is rethrown.
      void logAiRequest({
        feature_used: "scan-document",
        provider_name: "Gemini",
        status: "Error",
        error_message: String(scanError?.message || scanError).slice(0, 500),
      });
      validationIssues.push(
        "AI document scanning is unavailable right now. Please enter the details manually."
      );
    }

    if (model && Object.keys(extractedData).length === 0) {
      validationIssues.push(
        "Could not automatically read fields from the document scan image. Please retake it with better lighting and the full document in frame, or enter details manually."
      );
    }

    let ltoSchedule = null;
    if (extractedData.plate_number) {
      ltoSchedule = calculateLtoRenewalSchedule(extractedData.plate_number);
    }

    return ok({
      document_type: documentType,
      file_url: fileUrl,
      extracted_data: extractedData,
      confidence_scores: {},
      lto_schedule: ltoSchedule,
      validation_issues: validationIssues,
      is_ai_vision_used: Boolean(model),
      scan_engine: model ? "gemini" : null,
      model,
      parsed_at: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, "Failed to scan document");
  }
}
