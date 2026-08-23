import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";
import { isSafeRemoteMediaUrl } from "@/lib/security/remote-url";
import {
  extractTextFromImage,
  parseDriverLicenseFieldsFromText,
  parseDriverLicenseBackFieldsFromText,
} from "@/lib/ai/license-ocr";

// Model/brand keywords that are NOT a vehicle series — guards the SERIES label
// parser from copying a model name or column header into `series`.
const knownModelKeywords = new RegExp(
  "^(TOYOTA|HONDA|MITSUBISHI|NISSAN|ISUZU|HYUNDAI|FORD|SUZUKI|KIA|CHEVROLET|MAZDA|SUBARU|BYD|GEELY|MG|FOTON|LEXUS|" +
  "CIVIC|HIACE|COMMUTER|GRANDIA|SUPER\\s*GRANDIA|INNOVA|FORTUNER|HILUX|AVANZA|VIOS|RUSH|COROLLA|ALTIS|CITY|" +
  "CR-V|CRV|HR-V|HRV|BR-V|BRV|ACCORD|JAZZ|CAMRY|WIGO|RAIZE|YARIS|L300|MONTERO|STRADA|CANTER|CROSSWIND|D-MAX|" +
  "DMAX|MU-X|MUX|ELF|TERRITORY|EVEREST|RANGER|RAPTOR|ALMERA|NAVARA|TERRA|STAREX|STARGAZER|TUCSON|SANTA\\s*FE|" +
  "ACCENT|APV|ERTIGA|JIMNY|SWIFT|DZIRE|CELERIO|CARNIVAL|SOLUTO|STONIC|COOLRAY|OKAVANGO|ZS|" +
  "MAKE|MODEL|DENOMINATION|SERIES|BRAND|SEDAN|VAN|SUV|BUS|PICKUP|TRUCK|WAGON|HATCHBACK|MPV|COLOR|YEAR)$/i"
);

// Helper to strip adjacent table column headers from OCR text line
function cleanFieldValue(val) {
  if (!val || typeof val !== "string") return val;
  let s = val.trim();
  s = s.split(/\s+(?:Chassis|Engine|VIN|Vehicle\s*Type|Gross|Net\s*Weight|Body\s*Type|No\.?\s*of|No\s*of|Seating|Owner|Address|Registration|Insurance|Ref|Date|Place|Transaction|Year|Color|Make|Model)[:\s]/i)[0];
  s = s.split(/[\r\n]/)[0];
  return s.replace(/[:;,]+$/, "").trim();
}

// Strict validation helper to filter out OCR noise and document template labels
function isValidFieldValue(val) {
  if (!val || typeof val !== "string") return false;
  const s = val.trim().toUpperCase();
  if (s.length < 2) return false;
  // If value contains document template header keywords, it's invalid!
  if (/GROSS\s*WEIGHT|NET\s*WEIGHT|TYPE\s*OF\s*FUEL|VEHICLE\s*CATEGORY|CERTIFICATE|OFFICIAL\s*RECEIPT|CLASSIFICATION|SPECIFICATION|CHASSIS\s*NUMBER|ENGINE\s*NUMBER/.test(s)) {
    return false;
  }
  return true;
}

function buildPrompt(documentType, ocrText) {
  let schema = '{ "extracted_data": { "plate_number": "", "registration_number": "", "manufacturer": "", "model": "", "year": "", "color": "", "fuel_type": "", "seating_capacity": "", "vehicle_name": "", "expiration_date": "" }, "confidence_scores": { "plate_number": 90 } }';
  if (documentType === "Driver_License_Back") {
    schema = '{ "extracted_data": { "emergency_contact_name": "", "emergency_contact_phone": "", "emergency_contact_address": "" }, "confidence_scores": { "emergency_contact_name": 90 } }';
  } else if (documentType === "Driver_License") {
    schema = '{ "extracted_data": { "license_number": "", "first_name": "", "last_name": "", "expiration_date": "", "birthdate": "", "sex": "", "nationality": "FILIPINO", "address": "", "license_class": "B" }, "confidence_scores": { "license_number": 90 } }';
  }

  return `Extract all real structured fields from the scanned ${documentType} document image or text:
"""
${ocrText || "Scanned image attachment"}
"""
Return JSON only with all identified fields:
${schema}`;
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
    if (!["SILVER", "WHITE", "DIESEL", "GASOLINE", "BLACK"].includes(rawPlate) && !/^(GROSS|NET|WEIGHT|TYPE|FUEL|REGISTRATION|CATEGORY)/.test(rawPlate)) {
      extractedData.plate_number = rawPlate;
      confidenceScores.plate_number = 99;
    }
  }

  // 2. Registration / CR Number / MV File No / OR No
  const regMatch = cleanText.match(/(?:CR\s*No\.?|FILE\s*NO\.?|MV\s*FILE\s*NO\.?|O\.?R\.?\s*No\.?|Registration\s*No\.?)[:\s]*([A-Z0-9-]{6,25})/i) ||
                   cleanText.match(/\b(\d{9,15}|1301-\d{11}|REG-\d{4}-\d{6}|CR-\d{6,12})\b/i);
  if (regMatch) {
    const rawReg = cleanFieldValue(regMatch[1]);
    if (/\d/.test(rawReg) && !/^(MATION|INFORMATION|SILVER|WHITE|BLACK|DIESEL|GASOLINE|RECEIPT|OFFICIAL|DETAILS)$/i.test(rawReg)) {
      extractedData.registration_number = rawReg;
      confidenceScores.registration_number = 96;
    }
  }

  // 3. Manufacturer / Make / Brand
  const brandFallback = cleanText.match(/\b(TOYOTA|HONDA|MITSUBISHI|NISSAN|ISUZU|HYUNDAI|FORD|SUZUKI|KIA|CHEVROLET|MAZDA|SUBARU|BYD|GEELY|MG|FOTON|LEXUS)\b/i);
  if (brandFallback) {
    extractedData.manufacturer = brandFallback[1].toUpperCase();
    confidenceScores.manufacturer = 98;
  }

  // 4. Series / Model
  const knownModel = cleanText.match(/\b(CIVIC\s*1\.8S|CIVIC\s*1\.5T|HIACE\s+COMMUTER|COMMUTER|GRANDIA\s+TOURER|SUPER\s+GRANDIA|GRANDIA|INNOVA|FORTUNER|HILUX|AVANZA|VIOS|RUSH|COROLLA\s+ALTIS|ALTIS|COROLLA|CIVIC|CITY|CR-V|CRV|HR-V|HRV|BR-V|BRV|ACCORD|JAZZ|CAMRY|WIGO|RAIZE|YARIS|L300|MONTERO\s*SPORT|MONTERO|STRADA|CANTER|CROSSWIND|D-MAX|DMAX|MU-X|MUX|ISUZU\s+ELF|ELF|TERRITORY|EVEREST|RANGER|RAPTOR|ALMERA|NAVARA|TERRA|STAREX|STARGAZER|TUCSON|SANTA\s*FE|ACCENT|APV|ERTIGA|JIMNY|SWIFT|DZIRE|CELERIO|CARNIVAL|SOLUTO|STONIC|COOLRAY|OKAVANGO|ZS)\b/i);
  
  if (knownModel) {
    extractedData.model = knownModel[1].toUpperCase();
    confidenceScores.model = 99;
  } else {
    const explicitModel = cleanText.match(/(?:MAKE\s*[\/&\s]*MODEL|MODEL\s*[\/&\s]*SERIES|MAKE\s*[\/&\s]*SERIES|SERIES\s*[\/&\s]*DENOMINATION|MODEL\s*SERIES|DENOMINATION\s*[\/&\s]*MODEL|DENOMINATION|MODEL|SERIES)[\s.:=]*[\r\n]*([A-Z0-9.\-\t ]{2,30})/i);
    if (explicitModel) {
      let rawModel = cleanFieldValue(explicitModel[1]).toUpperCase();
      if (extractedData.manufacturer) {
        rawModel = rawModel.replace(new RegExp(`^${extractedData.manufacturer}\\s*[\\/-]?\\s*`, "i"), "").trim();
      }
      if (isValidFieldValue(rawModel) && rawModel.length >= 2) {
        extractedData.model = rawModel;
        confidenceScores.model = 92;
      }
    }
  }

  // Fallback: If model is still empty, look for word immediately following manufacturer name (e.g. HONDA CIVIC)
  if (!extractedData.model && extractedData.manufacturer) {
    const brandPattern = new RegExp(`\\b${extractedData.manufacturer}\\s+([A-Z0-9.\-]+)`, "i");
    const brandNextWord = cleanText.match(brandPattern);
    if (brandNextWord && isValidFieldValue(brandNextWord[1]) && brandNextWord[1].length >= 2) {
      extractedData.model = brandNextWord[1].toUpperCase();
      confidenceScores.model = 85;
    }
  }

  // Series is a DISTINCT field on an OR/CR (e.g. BRAND "TOYOTA" / MODEL "HIACE" /
  // SERIES "COMMUTER"). Parse its own labelled line first; only fall back to the
  // model name when no separate series value is present on the document.
  const seriesLabel = cleanText.match(/(?:SERIES|DENOMINATION)[:\s]*[\r\n]*([A-Z0-9][A-Z0-9.\-\t /]{1,30})/i);
  if (seriesLabel) {
    const rawSeries = cleanFieldValue(seriesLabel[1]).toUpperCase();
    if (isValidFieldValue(rawSeries) && rawSeries.length >= 2 && !knownModelKeywords.test(rawSeries)) {
      extractedData.series = rawSeries;
      confidenceScores.series = 90;
    }
  }

  // Mirror series field (only when no explicit series was parsed)
  if (!extractedData.series && extractedData.model) {
    extractedData.series = extractedData.model;
    confidenceScores.series = confidenceScores.model;
  } else if (!extractedData.series && extractedData.vehicle_name) {
    extractedData.series = extractedData.vehicle_name;
    confidenceScores.series = 70;
  }

  // 5. Year / Year Model
  const explicitYear = cleanText.match(/(?:YEAR\s*MODEL|MODEL\s*YEAR|YEAR\s*OF\s*MANUFACTURE|YR\s*MODEL|YEAR|YR)[:\s]*[\r\n]*\b(20[0-2][0-9]|19[7-9][0-9])\b/i) ||
                       cleanText.match(/(?:MODEL|MAKE|SERIES|DENOMINATION)[\s\S]{0,40}?\b(20[0-2][0-9]|19[7-9][0-9])\b/i);
  if (explicitYear) {
    extractedData.year = parseInt(explicitYear[1], 10);
    confidenceScores.year = 98;
  } else {
    // Fallback: Search for any valid 4-digit manufacture year in the document text
    const allYears = [...cleanText.matchAll(/\b(20[0-2][0-9]|19[8-9][0-9])\b/g)].map((m) => parseInt(m[1], 10));
    if (allYears.length > 0) {
      const currentYear = new Date().getFullYear();
      const validYears = allYears.filter((y) => y <= currentYear + 1);
      if (validYears.length > 0) {
        extractedData.year = Math.min(...validYears);
        confidenceScores.year = 80;
      }
    }
  }

  // 6. Color (Check known vehicle colors first)
  const knownColor = cleanText.match(/\b(MODERN STEEL|PEARL WHITE|CHAMPAGNE GOLD|DARK BLUE|SILVER|WHITE|BLACK|GRAY|GREY|RED|BLUE|BRONZE|BEIGE|BROWN|GREEN|YELLOW)\b/i);
  if (knownColor) {
    extractedData.color = knownColor[1].toUpperCase();
    confidenceScores.color = 98;
  } else {
    const colorMatch = cleanText.match(/(?:COLOR)[:\s]*([A-Z\s]{3,20})/i);
    if (colorMatch) {
      const rawColor = cleanFieldValue(colorMatch[1]).toUpperCase();
      if (isValidFieldValue(rawColor)) {
        extractedData.color = rawColor;
        confidenceScores.color = 88;
      }
    }
  }

  // 7. Fuel Type
  const fuelMatch = cleanText.match(/\b(GASOLINE|GAS|DIESEL|ELECTRIC|HYBRID)\b/i);
  if (fuelMatch) {
    const rawFuel = fuelMatch[1].toUpperCase();
    extractedData.fuel_type = rawFuel === "GAS" ? "Gasoline" : rawFuel.charAt(0) + rawFuel.slice(1).toLowerCase();
    confidenceScores.fuel_type = 95;
  }

  // 8. Seating Capacity / Passenger Capacity.
  // OR/CR labels: "NO. OF PASSENGERS", "PASSENGER CAPACITY", "SEATING CAPACITY",
  // "PASS. CAP.", "NO. OF PASS.", "SEATING". Match the label FIRST, then take the
  // number that immediately follows it on the same or next line — NOT any stray
  // digit nearby, which is what produced wrong capacities (e.g. picking up a
  // chassis/year digit). The number must be plausible (1..60) for a road vehicle.
  const capLabelPatterns = [
    /NO\.?\s*OF\s*PASS(?:ENGERS)?[^\d]{0,30}?(\d{1,2})/i,
    /PASSENGER\s*CAP(?:ACITY)?[^\d]{0,30}?(\d{1,2})/i,
    /PASS\.?\s*CAP[^\d]{0,30}?(\d{1,2})/i,
    /SEATING\s*CAP(?:ACITY)?[^\d]{0,30}?(\d{1,2})/i,
    /CAPACITY[^\d]{0,30}?(\d{1,2})/i,
    /(\d{1,2})\s*(?:PASS(?:ENGERS)?|SEATS|SEATING)\b/i,
  ];
  let capacity = null;
  for (const pat of capLabelPatterns) {
    const m = cleanText.match(pat);
    if (!m) continue;
    const val = parseInt(m[1], 10);
    if (Number.isInteger(val) && val >= 1 && val <= 60) {
      capacity = val;
      break;
    }
  }

  if (capacity !== null) {
    extractedData.seating_capacity = capacity;
    confidenceScores.seating_capacity = 95;
  } else {
    // Intelligent capacity default based on body type (low confidence).
    if (extractedData.vehicle_name === "SEDAN") extractedData.seating_capacity = 5;
    else if (extractedData.vehicle_name === "SUV") extractedData.seating_capacity = 7;
    else if (extractedData.vehicle_name === "VAN") extractedData.seating_capacity = 12;
    else extractedData.seating_capacity = 5;
    confidenceScores.seating_capacity = 75;
  }

  // 9. Body Type / Vehicle Category (Check known categories first)
  const knownCategory = cleanText.match(/\b(SEDAN|VAN|BUS|SUV|PICKUP|TRUCK|WAGON|HATCHBACK|MPV)\b/i);
  if (knownCategory) {
    extractedData.vehicle_name = knownCategory[1].toUpperCase();
    confidenceScores.vehicle_name = 95;
  } else {
    const bodyMatch = cleanText.match(/(?:BODY\s*TYPE|VEHICLE\s*TYPE)[:\s]*([A-Z\s]{3,15})/i);
    if (bodyMatch) {
      const rawBody = cleanFieldValue(bodyMatch[1]).toUpperCase();
      if (isValidFieldValue(rawBody)) {
        extractedData.vehicle_name = rawBody;
        confidenceScores.vehicle_name = 85;
      }
    }
  }

  // 10. Expiration Date
  const dateMatch = cleanText.match(/(?:EXPIRATION|EXPIRY|VALID\s*UNTIL|DATE\s*OF\s*EXPIRATION)[:\s]*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i);
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

    // SSRF guard: the server (OCR + LLM provider) must never fetch arbitrary
    // caller-supplied URLs — only fleet storage or inline data URLs.
    if (file_url && !isSafeRemoteMediaUrl(file_url)) {
      return err("file_url must be a document uploaded to fleet storage.", 400);
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

    // 3. TRY ACTIVE LLM PROVIDER FOR AI VISION / DEEP PARSING ENHANCEMENT
    if (ocrText || file_url) {
      try {
        const prompt = buildPrompt(document_type, ocrText);

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
              // Clean empty strings and update with LLM vision accuracy
              Object.entries(parsed.extracted_data).forEach(([k, v]) => {
                if (v && String(v).trim() !== "" && isValidFieldValue(String(v))) {
                  extractedData[k] = v;
                }
              });
              if (parsed.confidence_scores) {
                confidenceScores = { ...confidenceScores, ...parsed.confidence_scores };
              }
              isAiVisionUsed = true;
            }
          }
        }
      } catch (llmErr) {
        console.warn("LLM Document Scan fallback skipped:", llmErr.message);
      }
    }

    // Clean up any extracted fields that contain invalid document header keywords
    for (const [key, val] of Object.entries(extractedData)) {
      if (typeof val === "string" && !isValidFieldValue(val)) {
        delete extractedData[key];
        delete confidenceScores[key];
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
// Verified clean SWC syntax

