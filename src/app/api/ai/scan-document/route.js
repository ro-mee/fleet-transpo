import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";

// Helper function to extract document text using Tesseract OCR with fast timeout
async function extractTextFromImage(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return "";

  try {
    const ocrPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      const ret = await worker.recognize(fileUrl);
      await worker.terminate();
      return ret.data.text || "";
    })();

    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve(""), 2500)
    );

    return await Promise.race([ocrPromise, timeoutPromise]);
  } catch (err) {
    console.warn("Tesseract OCR timeout/error:", err.message);
    return "";
  }
}

// Helper to strip adjacent table column headers from OCR text line
function cleanFieldValue(val) {
  if (!val || typeof val !== "string") return val;
  let s = val.trim();

  // Cut off at adjacent column headers
  s = s.split(/\s+(?:Chassis|Engine|VIN|Vehicle\s*Type|Gross|Net\s*Weight|Body\s*Type|No\.?\s*of|No\s*of|Seating|Owner|Address|Registration|Insurance|Ref|Date|Place|Transaction)[:\s]/i)[0];
  
  return s.replace(/[:;,]+$/, "").trim();
}

// Regex rules to parse key vehicle document fields from raw OCR text
function parseVehicleFieldsFromText(text) {
  if (!text) return { extractedData: {}, confidenceScores: {} };

  const extractedData = {};
  const confidenceScores = {};
  const cleanText = text.replace(/\r/g, "");

  // 1. Plate Number (e.g. NBO 1234, NBO-1234, ABC-1234, XYZ-5678)
  const plateMatch = cleanText.match(/(?:PLATE\s*(?:NO\.?|NUMBER)?[:\s]*)([A-Z]{2,3}\s*[-]?\s*\d{3,4})/i) ||
                     cleanText.match(/\b([A-Z]{3}\s*\d{4}|[A-Z]{3}-\d{4}|[A-Z]{2}\s*\d{4})\b/i);
  if (plateMatch) {
    const rawPlate = cleanFieldValue(plateMatch[1]).replace(/\s+/, " ").toUpperCase();
    if (!["SILVER", "WHITE", "DIESEL", "GASOLINE", "BLACK"].includes(rawPlate)) {
      extractedData.plate_number = rawPlate;
      confidenceScores.plate_number = 99;
    }
  }

  // 2. Registration / CR / File / OR Number (e.g. 272589463, 1301-00001234567, 000123456789012)
  const regMatch = cleanText.match(/(?:CR\s*No\.?|FILE\s*NO\.?|O\.?R\.?\s*No\.?|Registration\s*No\.?)[:\s]*([A-Z0-9-]{6,25})/i) ||
                   cleanText.match(/\b(\d{9,15}|1301-\d{11}|REG-\d{4}-\d{6})\b/i);
  if (regMatch) {
    const rawReg = cleanFieldValue(regMatch[1]);
    if (/\d/.test(rawReg) && !/^(MATION|INFORMATION|SILVER|WHITE|BLACK|DIESEL|GASOLINE|RECEIPT|OFFICIAL|DETAILS)$/i.test(rawReg)) {
      extractedData.registration_number = rawReg;
      confidenceScores.registration_number = 96;
    }
  }

  // 3. Manufacturer / Make / Brand (e.g. TOYOTA, HONDA, MITSUBISHI, NISSAN)
  const brandFallback = cleanText.match(/\b(TOYOTA|HONDA|MITSUBISHI|NISSAN|ISUZU|HYUNDAI|FORD|SUZUKI|KIA|CHEVROLET|MAZDA|SUBARU)\b/i);
  if (brandFallback) {
    extractedData.manufacturer = brandFallback[1].toUpperCase();
    confidenceScores.manufacturer = 98;
  } else {
    const mfrMatch = cleanText.match(/(?:MAKE\s*\/?\s*BRAND|MANUFACTURER)[:\s]*([A-Z0-9\s]+?)(?=\s+(?:BODY|SERIES|GROSS|NET|YEAR|PASSENGER|COLOR|TYPE|OWNER|ENGINE|CHASSIS|\n|\r|$))/i);
    if (mfrMatch) {
      let mfr = mfrMatch[1].trim();
      mfr = mfr.replace(/\s+Motors$/i, "").trim();
      if (mfr && !/^(FILE|VEHICLE|CATEGORY|PRIVATE|BODY|SERIES|GROSS)$/i.test(mfr)) {
        extractedData.manufacturer = mfr;
        confidenceScores.manufacturer = 96;
      }
    }
  }

  // 4. Model / Series (e.g. HIACE COMMUTER, L300, NV350, INNOVA, FORTUNER, HILUX, ANF100MSPJ)
  const knownSeries = cleanText.match(/\b(HIACE\s+COMMUTER|HIACE|L300|NV350|URVAN|INNOVA|FORTUNER|HILUX|AVANZA|VIOS|RUSH|COROLLA|CIVIC|CR-V|MONTERO|STRADA|CANTER|ISUZU\s+ELF|ANF100MSPJ)\b/i);
  if (knownSeries) {
    extractedData.model = knownSeries[1].toUpperCase();
    confidenceScores.model = 99;
  } else {
    const afterBodyMatch = cleanText.match(/(?:VAN|SEDAN|SUV|PICKUP|BUS|TRICYCLE|MOTORCYCLE)\s+([A-Z0-9\s-]+?)(?=\s+(?:\d{1,2},?\d{3}|\d{3,4}|GROSS|NET|YEAR|PASSENGER|COLOR|TYPE|\n|\r|$))/i) ||
                           cleanText.match(/(?:SERIES|MODEL)[:\s]*([A-Z0-9\s-]+?)(?=\s+(?:GROSS|NET|YEAR|PASSENGER|COLOR|TYPE|OWNER|ENGINE|CHASSIS|\n|\r|$))/i);
    if (afterBodyMatch) {
      let mdl = afterBodyMatch[1].trim();
      if (mdl && !/^(GROSS|NET|WEIGHT|BODY|TYPE|YEAR)$/i.test(mdl)) {
        extractedData.model = mdl;
        confidenceScores.model = 96;
      }
    }
  }

  // 5. Vehicle Type (e.g. VAN, SUV, SEDAN, BUS, MOTORCYCLE / MOPED / TRICYCLE, CARGO VAN, PICKUP)
  const typeMatch = cleanText.match(/(?:VEHICLE\s*TYPE)[:\s]*([A-Z0-9\/\s-]+?)(?=\s+(?:VEHICLE\s*CATEGORY|CATEGORY|MAKE|BRAND|BODY|SERIES|GROSS|NET|YEAR|\n|\r|$))/i) ||
                    cleanText.match(/\b(VAN|MOTORCYCLE\s*\/\s*MOPED\s*\/\s*TRICYCLE|MOTORCYCLE|TRICYCLE|CARGO\s*VAN|SUV|SEDAN|BUS|PICKUP|TRUCK)\b/i);
  if (typeMatch) {
    let vt = typeMatch[1].trim();
    if (vt && !/^(VEHICLE|CATEGORY|PRIVATE|MAKE|BRAND)$/i.test(vt)) {
      extractedData.vehicle_type = vt.toUpperCase();
      extractedData.vehicle_name = vt.toUpperCase();
      confidenceScores.vehicle_type = 98;
      confidenceScores.vehicle_name = 98;
    }
  }

  if (!extractedData.vehicle_name && (extractedData.manufacturer || extractedData.model)) {
    extractedData.vehicle_name = `${extractedData.manufacturer || ''} ${extractedData.model || ''}`.trim();
    confidenceScores.vehicle_name = 95;
  }

  // 6. Year Model (e.g. 2023, 2024, 2010)
  const yearMatch = cleanText.match(/(?:YEAR\s*MODEL|YEAR)[:\s]*(\d{4})/i);
  if (yearMatch) {
    extractedData.year = parseInt(yearMatch[1], 10);
    confidenceScores.year = 98;
  }

  // 7. Color (e.g. WHITE PEARL, TAFFETA WHITE, SILVER, CRYSTAL BLACK, RED, BLUE)
  const colorFallback = cleanText.match(/\b(WHITE PEARL|TAFFETA WHITE|CRYSTAL BLACK|LUNAR SILVER|ALABASTER SILVER|MODERN STEEL|RALLYE RED|WHITE|BLACK|SILVER|GRAY|GREY|RED|BLUE|BROWN|BEIGE|GREEN|YELLOW|ORANGE|BLUE\/BLACK)\b/i);
  if (colorFallback) {
    extractedData.color = colorFallback[1].toUpperCase();
    confidenceScores.color = 98;
  } else {
    const colorMatch = cleanText.match(/(?:COLOR)[:\s]*([A-Z0-9\/\s]+?)(?=\s+(?:TYPE|FUEL|REGISTRATION|CLASSIFICATION|OWNER|ENGINE|CHASSIS|\n|\r|$))/i);
    if (colorMatch) {
      let col = colorMatch[1].trim();
      if (col && !/TYPE|FUEL|REGISTRATION|CLASSIFICATION/i.test(col)) {
        extractedData.color = col;
        confidenceScores.color = 95;
      }
    }
  }

  // 8. Type of Fuel (e.g. DIESEL, GAS, GASOLINE)
  const fuelFallback = cleanText.match(/\b(DIESEL|GASOLINE|GAS|ELECTRIC|HYBRID)\b/i);
  if (fuelFallback) {
    let rawFuel = fuelFallback[1].trim();
    if (/diesel/i.test(rawFuel)) rawFuel = "Diesel";
    else if (/gas/i.test(rawFuel)) rawFuel = "Gasoline";
    else if (/electric/i.test(rawFuel)) rawFuel = "Electric";
    else if (/hybrid/i.test(rawFuel)) rawFuel = "Hybrid";
    extractedData.fuel_type = rawFuel;
    confidenceScores.fuel_type = 98;
  }

  // 9. Passenger Capacity / Seating Capacity (e.g. 15, 1, 4, 7, 10, 12, 14)
  const capMatch = cleanText.match(/(?:PASSENGER\s*CAPACITY|SEATING\s*CAPACITY)[:\s]*(\d{1,3})/i) ||
                   cleanText.match(/(?:PASSENGER\s*CAPACITY|SEATING\s*CAPACITY)[\s\S]{1,60}?\b(\d{1,3})\b/i);
  if (capMatch) {
    const capVal = parseInt(capMatch[1], 10);
    if (capVal > 0 && capVal <= 100) {
      extractedData.seating_capacity = capVal;
      confidenceScores.seating_capacity = 96;
    }
  }

  // 10. Engine Number (e.g. 2KD-FT123456)
  const engMatch = cleanText.match(/(?:ENGINE\s*NO\.?)[:\s]*([A-Z0-9-]{5,20})/i);
  if (engMatch) {
    let eng = engMatch[1].trim();
    if (eng && !/^(CHASSIS|VIN|FILE)$/i.test(eng)) {
      extractedData.engine_number = eng;
      confidenceScores.engine_number = 96;
    }
  }

  // 11. Chassis Number (e.g. MHFXB9GS1P1234567)
  const chasMatch = cleanText.match(/(?:CHASSIS\s*NO\.?)[:\s]*([A-Z0-9-]{5,25})/i);
  if (chasMatch) {
    let chas = chasMatch[1].trim();
    if (chas && !/^(VIN|FILE|MAKE)$/i.test(chas)) {
      extractedData.chassis_number = chas;
      confidenceScores.chassis_number = 96;
    }
  }

  // 12. Owner Name (e.g. JUAN DELA CRUZ)
  const ownerMatch = cleanText.match(/(?:OWNER'S\s*NAME|OWNER\s*NAME)[:\s]*([^\n\r]+)/i);
  if (ownerMatch) {
    let own = cleanFieldValue(ownerMatch[1]);
    if (own && !/^(OWNER|ADDRESS|ENCUMBERED)$/i.test(own)) {
      extractedData.owner_name = own;
      confidenceScores.owner_name = 95;
    }
  }

  return { extractedData, confidenceScores };
}

export async function POST(req) {
  try {
    // Document scanning feeds vehicle onboarding — restrict to roles that
    // can create/update vehicles.
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const body = await parseBody(req);
    const { document_type, document_text, file_url } = body;

    if (!document_type) {
      return err("Document type is required (Driver_License, OR_CR, Insurance)", 400);
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

    // 2. PARSE EXTRACTED TEXT VIA REGEX / PATTERNS
    if (ocrText) {
      const parsedOcr = parseVehicleFieldsFromText(ocrText);
      if (Object.keys(parsedOcr.extractedData).length > 0) {
        extractedData = { ...parsedOcr.extractedData };
        confidenceScores = { ...parsedOcr.confidenceScores };
        isAiVisionUsed = true;
      }
    }

    // 3. ENRICH OR EXTRACT VIA ACTIVE LLM MODEL IF AVAILABLE
    if (ocrText || file_url) {
      const prompt = `You are an expert vehicle document scanner.
Extracted OCR text from the uploaded ${document_type} document image:
"""
${ocrText || "Scanned image attachment"}
"""

Extract structured JSON fields. Return ONLY valid JSON:
{
  "extracted_data": {
    "plate_number": "Extracted plate or null",
    "registration_number": "CR or File number or null",
    "vehicle_type": "Vehicle Type e.g. VAN, SUV, SEDAN, BUS, MOTORCYCLE, TRICYCLE",
    "vehicle_name": "Vehicle Type e.g. VAN, SUV, SEDAN, BUS",
    "manufacturer": "Make or Brand e.g. TOYOTA",
    "model": "Series or Model e.g. HIACE COMMUTER",
    "year": 2023,
    "color": "Color or null",
    "fuel_type": "Gasoline/Diesel/Electric/Hybrid",
    "seating_capacity": 15,
    "engine_number": "Engine # or null",
    "chassis_number": "Chassis # or null",
    "owner_name": "Owner name or null"
  },
  "confidence_scores": {
    "plate_number": 98
  }
}`;

      const llmResult = await executeLlmCompletion({
        feature_used: "OCR Document Scan",
        user_prompt: prompt,
        image_url: file_url || null,
      });

      if (llmResult.success && llmResult.content) {
        try {
          let cleanContent = llmResult.content.trim();
          if (cleanContent.startsWith("```")) {
            cleanContent = cleanContent.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
          }

          const parsed = JSON.parse(cleanContent);
          const rawExtracted = parsed.extracted_data || parsed;
          const rawScores = parsed.confidence_scores || {};

          Object.keys(rawExtracted).forEach((k) => {
            if (rawExtracted[k] !== null && rawExtracted[k] !== undefined && rawExtracted[k] !== "") {
              extractedData[k] = rawExtracted[k];
              if (rawScores[k]) confidenceScores[k] = rawScores[k];
            }
          });

          isAiVisionUsed = true;
        } catch (e) {
          console.warn("LLM OCR JSON Parse Warning:", e.message);
        }
      }
    }

    // Ensure vehicle_name is strictly set to Vehicle Type (e.g. VAN)
    const typeFromText = ocrText.match(/\b(VAN|MOTORCYCLE\s*\/\s*MOPED\s*\/\s*TRICYCLE|MOTORCYCLE|TRICYCLE|CARGO\s*VAN|SUV|SEDAN|BUS|PICKUP|TRUCK)\b/i);
    if (typeFromText) {
      extractedData.vehicle_type = typeFromText[1].toUpperCase();
      extractedData.vehicle_name = typeFromText[1].toUpperCase();
      confidenceScores.vehicle_type = 99;
      confidenceScores.vehicle_name = 99;
    } else if (extractedData.vehicle_type) {
      extractedData.vehicle_name = extractedData.vehicle_type.toUpperCase();
    }

    // If nothing could be read, return an empty result and let the caller
    // enter the details manually. We never fabricate document data.
    if (Object.keys(extractedData).length === 0) {
      return ok({
        document_type,
        extracted_data: {},
        confidence_scores: {},
        overall_confidence: 0,
        is_ai_vision_used: isAiVisionUsed,
        lto_renewal_schedule: null,
        validation: {
          is_valid: false,
          issues: ["Could not read the document. Please enter the details manually."],
        },
      });
    }

    // Calculate LTO Renewal Schedule deterministically from plate number
    let ltoRenewalSchedule = null;
    if (extractedData.plate_number) {
      ltoRenewalSchedule = calculateLtoRenewalSchedule(extractedData.plate_number);
    }

    const scoreValues = Object.values(confidenceScores);
    const overallConfidence = scoreValues.length > 0
      ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
      : 95;

    return ok({
      document_type,
      extracted_data: extractedData,
      confidence_scores: confidenceScores,
      overall_confidence: overallConfidence,
      is_ai_vision_used: isAiVisionUsed,
      lto_renewal_schedule: ltoRenewalSchedule,
      validation: {
        is_valid: validationIssues.length === 0,
        issues: validationIssues,
      },
    });
  } catch (e) { return handleError(e); }
}
