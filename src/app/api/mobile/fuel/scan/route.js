import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { extractTextFromImage } from "@/lib/ai/license-ocr";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { storeFuelReceipt } from "@/lib/fuel/receipt-storage";

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const formData = await req.formData();
    const file = formData.get("receipt");

    let storedReceipt;
    try {
      storedReceipt = await storeFuelReceipt(file, session.user.driverId);
    } catch (error) {
      return err(error.message || "Failed to upload receipt image.", 400);
    }
    const { fileBuffer, contentType, receiptUrl } = storedReceipt;

    // 2. Perform OCR
    let extractedData = {};
    let confidenceScores = {};
    
    // Pass binary to OCR as base64 data url
    const base64 = Buffer.from(fileBuffer).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;
    
    let ocrText = "";
    try {
      ocrText = await extractTextFromImage(dataUrl);
    } catch (e) {
      console.warn("Tesseract OCR failed on fuel receipt:", e.message);
    }

    // 3. LLM Parsing
    const prompt = `Extract fuel receipt details from the scanned text or image:
"""
${ocrText || "Scanned image attachment"}
"""
Return JSON only with these identified fields:
{ "extracted_data": { "station_name": "", "liters": 0.0, "amount": 0.0, "fuel_date": "YYYY-MM-DD" }, "confidence_scores": { "station_name": 90 } }`;

    try {
      const llmRes = await executeLlmCompletion({
        feature_used: "Fuel Receipt OCR",
        user_prompt: prompt,
        image_url: dataUrl,
        user_email: session.user?.email || "driver",
        provider_name: "Gemini",
      });

      if (llmRes && llmRes.success && llmRes.content) {
        const match = llmRes.content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.extracted_data) {
            extractedData = parsed.extracted_data;
            if (parsed.confidence_scores) {
              confidenceScores = parsed.confidence_scores;
            }
          }
        }
      }
    } catch (llmErr) {
      console.warn("LLM Fuel Receipt Parse fallback skipped:", llmErr.message);
    }

    return ok({
      receipt_url: receiptUrl,
      extracted_data: extractedData,
      confidence_scores: confidenceScores,
    });
  } catch (error) {
    return handleError(error, "Failed to scan fuel receipt");
  }
}
