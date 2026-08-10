import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractTextFromImage } from "@/lib/ai/license-ocr";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { v4 as uuidv4 } from "uuid";

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const formData = await req.formData();
    const file = formData.get("receipt");

    if (!file || typeof file === "string") {
      return err("A valid receipt image file is required.", 400);
    }

    // 1. Upload to Supabase Storage
    const supabase = createAdminClient();
    const fileBuffer = await file.arrayBuffer();
    const fileExt = file.name ? file.name.split(".").pop() : "jpg";
    const fileName = `${session.user.driverId}/${uuidv4()}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("fuel-receipts")
      .upload(fileName, fileBuffer, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase Storage Error:", uploadError);
      return err("Failed to upload receipt image.", 500);
    }

    // Generate signed URL valid for 10 years (effectively permanent for the record, but private)
    const { data: signedData } = await supabase.storage
      .from("fuel-receipts")
      .createSignedUrl(fileName, 60 * 60 * 24 * 365 * 10);
      
    const receiptUrl = signedData?.signedUrl;

    if (!receiptUrl) {
      return err("Failed to generate secure URL for receipt.", 500);
    }

    // 2. Perform OCR
    let extractedData = {};
    let confidenceScores = {};
    
    // Pass binary to OCR as base64 data url
    const base64 = Buffer.from(fileBuffer).toString('base64');
    const dataUrl = `data:${file.type || 'image/jpeg'};base64,${base64}`;
    
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
