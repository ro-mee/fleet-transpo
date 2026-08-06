import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";
import {
  extractTextFromImage,
  parseDriverLicenseFieldsFromText,
  parseDriverLicenseBackFieldsFromText,
} from "@/lib/ai/license-ocr";

// Helper to strip adjacent table column headers from OCR text line
function cleanFieldValue(val) {
  if (!val || typeof val !== "string") return val;
  let s = val.trim();
  s = s.split(/\s+(?:Chassis|Engine|VIN|Vehicle\s*Type|Gross|Net\s*Weight|Body\s*Type|No\.?\s*of|No\s*of|Seating|Owner|Address|Registration|Insurance|Ref|Date|Place|Transaction)[:\s]/i)[0];
  return s.replace(/[:;,]+$/, "").trim();
}

// Regex rules for Vehicle OR/CR & Insurance Documents OCR
function parseVehicleFieldsFromText(text) {
  if (!text) return { extractedData: {}, confidenceScores: {} };

  const extractedData = {};
  const confidenceScores = {};
  const cleanText = text.replace(/\r/g, "");

  // 1. Plate Number
  const plateMatch = cleanText.match(/(?:PLATE\s*(?:NO\.?|NUMBER)?[:\s]*)([A-Z]{2,3}\s*[-]?\s*\d{3,4})/i) ||
                     cleanText.match(/\b([A-Z]{3}\s*\d{4}|[A-Z]{3}-\d{4}|[A-Z]{2}\s*\d{4})\b/i);
  if (plateMatch) {
    const rawPlate = cleanFieldValue(plateMatch[1]).replace(/\s+/, " ").toUpperCase();
    if (!["SILVER", "WHITE", "DIESEL", "GASOLINE", "BLACK"].includes(rawPlate)) {
      extractedData.plate_number = rawPlate;
      confidenceScores.plate_number = 99;
    }
  }

  // 2. Registration / CR Number
  const regMatch = cleanText.match(/(?:CR\s*No\.?|FILE\s*NO\.?|O\.?R\.?\s*No\.?|Registration\s*No\.?)[:\s]*([A-Z0-9-]{6,25})/i) ||
                   cleanText.match(/\b(\d{9,15}|1301-\d{11}|REG-\d{4}-\d{6})\b/i);
  if (regMatch) {
    const rawReg = cleanFieldValue(regMatch[1]);
    if (/\d/.test(rawReg) && !/^(MATION|INFORMATION|SILVER|WHITE|BLACK|DIESEL|GASOLINE|RECEIPT|OFFICIAL|DETAILS)$/i.test(rawReg)) {
      extractedData.registration_number = rawReg;
      confidenceScores.registration_number = 96;
    }
  }

  // 3. Manufacturer / Make / Brand
  const brandFallback = cleanText.match(/\b(TOYOTA|HONDA|MITSUBISHI|NISSAN|ISUZU|HYUNDAI|FORD|SUZUKI|KIA|CHEVROLET|MAZDA|SUBARU)\b/i);
  if (brandFallback) {
    extractedData.manufacturer = brandFallback[1].toUpperCase();
    confidenceScores.manufacturer = 98;
  }

  // 4. Model / Series
  const knownSeries = cleanText.match(/\b(HIACE\s+COMMUTER|HIACE|L300|NV350|URVAN|INNOVA|FORTUNER|HILUX|AVANZA|VIOS|RUSH|COROLLA|CIVIC|CR-V|MONTERO|STRADA|CANTER|ISUZU\s+ELF|ANF100MSPJ)\b/i);
  if (knownSeries) {
    extractedData.model = knownSeries[1].toUpperCase();
    confidenceScores.model = 99;
  }

  // 5. Expiration Date
  const dateMatch = cleanText.match(/(?:EXPIRATION|EXPIRY|VALID\s*UNTIL|DATE\s*OF\s*EXPIRATION)[:\s]*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{4})/i);
  if (dateMatch) {
    extractedData.expiration_date = dateMatch[1];
    confidenceScores.expiration_date = 90;
  }

  return { extractedData, confidenceScores };
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, ["admin", "system_admin", "fleet_manager", "dispatcher"]);
    if (auth.error) return auth.error;

    const body = await parseBody(request);
    const { document_type, document_text, file_url } = body || {};

    if (!document_type) {
      return err("Document type is required (Driver_License, Driver_License_Back, OR_CR, Insurance)", 400);
    }

    let extractedData = {};
    let confidenceScores = {};
    let validationIssues = [];
    let isAiVisionUsed = false;

    // 1. EXTRACT REAL TEXT FROM IMAGE USING TESSERACT OCR
    let ocrText = document_text || "";
    if (!ocrText && file_url) {
      ocrText = await extractTextFromImage(file_url);
    }

    // 2. PARSE EXTRACTED OCR TEXT INSTANTLY VIA REGEX RULES
    if (document_type === "Driver_License_Back") {
      const parsedBack = parseDriverLicenseBackFieldsFromText(ocrText);
      extractedData = { ...parsedBack.extractedData };
      confidenceScores = { ...parsedBack.confidenceScores };
    } else if (document_type === "Driver_License") {
      const parsedLic = parseDriverLicenseFieldsFromText(ocrText);
      extractedData = { ...parsedLic.extractedData };
      confidenceScores = { ...parsedLic.confidenceScores };
    } else {
      const parsedOcr = parseVehicleFieldsFromText(ocrText);
      extractedData = { ...parsedOcr.extractedData };
      confidenceScores = { ...parsedOcr.confidenceScores };
    }

    // 3. IF REGEX MISSED KEY FIELDS, TRY ACTIVE LLM PROVIDER IF CONFIGURED
    const hasKeyFields =
      document_type === "Driver_License_Back"
        ? extractedData.emergency_contact_name || extractedData.emergency_contact_phone
        : document_type === "Driver_License"
        ? extractedData.license_number || extractedData.last_name
        : extractedData.plate_number || extractedData.registration_number;

    if (!hasKeyFields && (ocrText || file_url)) {
      try {
        const prompt = `Extract real structured fields from the scanned ${document_type} document image or text:
"""
${ocrText || "Scanned image attachment"}
"""
Return JSON only:
${
  document_type === "Driver_License_Back"
    ? '{ "extracted_data": { "emergency_contact_name": "", "emergency_contact_phone": "", "emergency_contact_address": "" }, "confidence_scores": { "emergency_contact_name": 90 } }'
    : document_type === "Driver_License"
    ? '{ "extracted_data": { "license_number": "", "first_name": "", "last_name": "", "expiration_date": "", "birthdate": "", "sex": "", "nationality": "FILIPINO", "address": "", "license_class": "B" }, "confidence_scores": { "license_number": 90 } }'
    : '{ "extracted_data": { "plate_number": "", "registration_number": "", "manufacturer": "", "model": "", "color": "", "expiration_date": "" }, "confidence_scores": { "plate_number": 90 } }'
}`;

        const llmRes = await executeLlmCompletion({
          feature_used: "Vehicle Document Scanning",
          user_prompt: prompt,
          image_url: file_url,
          user_email: auth.user?.email,
        });

        if (llmRes && llmRes.success && llmRes.content) {
          const match = llmRes.content.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.extracted_data) {
              extractedData = { ...extractedData, ...parsed.extracted_data };
              confidenceScores = { ...confidenceScores, ...parsed.confidence_scores };
              isAiVisionUsed = true;
            }
          }
        }
      } catch (llmErr) {
        console.warn("LLM Document Scan fallback skipped:", llmErr.message);
      }
    }

    // 4. LTO RENEWAL SCHEDULE COMPUTATION
    let ltoSchedule = null;
    if (extractedData.plate_number) {
      ltoSchedule = calculateLtoRenewalSchedule(extractedData.plate_number);
    }

    // 5. VALIDATION CHECKS (NO FAKE MOCK FALLBACKS)
    if (Object.keys(extractedData).length === 0) {
      validationIssues.push(
        "Could not automatically parse fields from the document scan image. Please verify image clarity or enter details manually."
      );
    }

    return ok({
      document_type,
      file_url: file_url || null,
      raw_ocr_text: ocrText,
      extracted_data: extractedData,
      confidence_scores: confidenceScores,
      lto_schedule: ltoSchedule,
      validation_issues: validationIssues,
      is_ai_vision_used: isAiVisionUsed,
      parsed_at: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, "Failed to scan document");
  }
}
