import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";

// Helper function to extract document text using Tesseract OCR
async function extractTextFromImage(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return "";

  try {
    const ocrPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");

      let inputSource = fileUrl;
      if (fileUrl.startsWith("data:")) {
        const base64Data = fileUrl.replace(/^data:image\/\w+;base64,/, "");
        inputSource = Buffer.from(base64Data, "base64");
      }

      const ret = await worker.recognize(inputSource);
      await worker.terminate();
      return ret.data.text || "";
    })();

    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve(""), 6000)
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
  s = s.split(/\s+(?:Chassis|Engine|VIN|Vehicle\s*Type|Gross|Net\s*Weight|Body\s*Type|No\.?\s*of|No\s*of|Seating|Owner|Address|Registration|Insurance|Ref|Date|Place|Transaction)[:\s]/i)[0];
  return s.replace(/[:;,]+$/, "").trim();
}

// Auto-correct common Philippine address OCR typos (e.g. MANIA -> MANILA)
function correctPhilippineAddressSpelling(addressStr) {
  if (!addressStr || typeof addressStr !== "string") return addressStr;

  let s = addressStr.toUpperCase();

  const corrections = [
    [/\bMANIA\b/g, "MANILA"],
    [/\bMANLIA\b/g, "MANILA"],
    [/\bMNILA\b/g, "MANILA"],
    [/\bSAMPALOK\b/g, "SAMPALOC"],
    [/\bQUEZ0N\b/g, "QUEZON"],
    [/\bCAL00CAN\b/g, "CALOOCAN"],
    [/\bPARANAKUE\b/g, "PARANAQUE"],
    [/\bSTRT\b/g, "STREET"],
  ];

  for (const [regex, replacement] of corrections) {
    s = s.replace(regex, replacement);
  }

  return s;
}

// Regex rules for Front of LTO Philippine Driver's License Card OCR
function parseDriverLicenseFieldsFromText(text) {
  if (!text) return { extractedData: {}, confidenceScores: {} };

  const extractedData = {};
  const confidenceScores = {};
  const cleanText = text.replace(/\r/g, "");

  // 1. License Number
  const licMatch = cleanText.match(/(?:LICENSE\s*(?:NO\.?|NUMBER)?[:\s]*)([A-Z]\d{2}-\d{2}-\d{6})/i) ||
                   cleanText.match(/\b([A-Z]\d{2}-\d{2}-\d{6})\b/i) ||
                   cleanText.match(/(?:LICENSE\s*NO\.?[:\s]*)([A-Z0-9-]{7,15})/i) ||
                   cleanText.match(/\b([A-Z]\d{2}\d{2}\d{6})\b/i);
  if (licMatch) {
    extractedData.license_number = licMatch[1].toUpperCase();
    confidenceScores.license_number = 99;
  }

  // 2. Name Extraction
  const nameCommaMatch = cleanText.match(/(?:NAME|DRIVER)?[:\s]*([A-Z\s]+),\s*([A-Z\s]+)/i);
  if (nameCommaMatch) {
    extractedData.last_name = nameCommaMatch[1].trim().toUpperCase();
    extractedData.first_name = nameCommaMatch[2].trim().toUpperCase();
    confidenceScores.last_name = 96;
    confidenceScores.first_name = 96;
  } else {
    const fullNameMatch = cleanText.match(/(?:NAME)[:\s]*([A-Z\s]{4,35})/i);
    if (fullNameMatch) {
      const parts = fullNameMatch[1].trim().split(/\s+/);
      if (parts.length >= 2) {
        extractedData.first_name = parts[0].toUpperCase();
        extractedData.last_name = parts.slice(1).join(" ").toUpperCase();
        confidenceScores.first_name = 92;
        confidenceScores.last_name = 92;
      }
    }
  }

  // 3. Address
  const addressMatch = cleanText.match(/(?:ADDRESS|ADD?\.?)[:\s]*([^\n\r]+)/i);
  if (addressMatch) {
    const lines = [addressMatch[1].trim()];
    const rest = cleanText.slice(cleanText.indexOf(addressMatch[0]) + addressMatch[0].length);
    const nextLines = rest.split(/\r?\n/);
    const KNOWN_NEXT = /^(DATE\s*OF\s*BIRTH|BIRTH\s*DATE|BIRTHDAY|DOB|SEX|GENDER|NATIONALITY|CITIZENSHIP|EXPIR(?:ATION|Y)|VALID\s*UNTIL|RESTRICTIONS|CONDITIONS|LICENSE\s*(?:NO\.?|NUMBER))/i;
    for (const line of nextLines) {
      const t = line.trim();
      if (!t) break;
      if (KNOWN_NEXT.test(t)) break;
      lines.push(t);
    }
    let raw = lines.join(" ").trim().replace(/\s+/g, " ");
    raw = raw.replace(/^[^A-Za-z0-9]+/, "").replace(/^[A-Z]{1,2}\s+[A-Z]{1,2}\s+(?=\d)/i, "").trim();
    if (raw) {
      extractedData.address = correctPhilippineAddressSpelling(raw);
      confidenceScores.address = 90;
    }
  }

  // 4. LTO Dates Extraction (Birthdate & Expiration Date)
  const allDates = [...cleanText.matchAll(/\b(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})\b/g)].map(m => m[1].replace(/\//g, "-"));
  
  if (allDates.length > 0) {
    allDates.sort((a, b) => {
      const yrA = parseInt(a.split("-")[0], 10);
      const yrB = parseInt(b.split("-")[0], 10);
      return yrA - yrB;
    });

    if (allDates.length >= 1) {
      extractedData.birthdate = allDates[0];
      confidenceScores.birthdate = 95;
    }

    if (allDates.length >= 2) {
      extractedData.expiration_date = allDates[allDates.length - 1];
      confidenceScores.expiration_date = 95;
    } else if (allDates.length === 1) {
      const yr = parseInt(allDates[0].split("-")[0], 10);
      if (yr >= 2024) {
        extractedData.expiration_date = allDates[0];
        confidenceScores.expiration_date = 90;
      }
    }
  }

  // 5. Sex / Gender Extraction
  const sexMatch = cleanText.match(/(?:SEX|GENDER)[:\s]*([MF]|MALE|FEMALE)\b/i) ||
                   cleanText.match(/\bSEX\b[\s:]*([MF]|MALE|FEMALE)\b/i) ||
                   cleanText.match(/\b(FILIPINO|PHL)\s+([MF])\b/i) ||
                   cleanText.match(/\b([MF])\s+(?:FILIPINO|PHL)\b/i) ||
                   cleanText.match(/\bSEX\b[^\n\r]{1,20}?\b([MF])\b/i);
  if (sexMatch) {
    const rawSex = (sexMatch[1] || sexMatch[2]).toUpperCase();
    extractedData.sex = rawSex.startsWith("F") || rawSex === "FEMALE" ? "F" : "M";
    confidenceScores.sex = 98;
  }

  // 6. Nationality / Citizenship
  const natMatch = cleanText.match(/\b(FILIPINO|PHL|PHILIPPINES)\b/i) ||
                   cleanText.match(/(?:NATIONALITY|CITIZENSHIP)[:\s]*([A-Z]{2,15})/i);
  if (natMatch) {
    let val = natMatch[1].toUpperCase();
    if (val === "PHILIPPINES" || val === "PHL") val = "FILIPINO";
    if (!["SEX", "GENDER", "WEIGHT", "HEIGHT", "BLOOD"].includes(val)) {
      extractedData.nationality = val;
      confidenceScores.nationality = 96;
    } else {
      extractedData.nationality = "FILIPINO";
      confidenceScores.nationality = 90;
    }
  } else {
    extractedData.nationality = "FILIPINO";
    confidenceScores.nationality = 90;
  }

  // 7. Restrictions / License Class
  const classMatch = cleanText.match(/(?:RESTRICTIONS|CODES|CLASS)[:\s]*([A-Z0-9,\s]+)/i);
  if (classMatch) {
    const cls = classMatch[1].trim().toUpperCase();
    if (cls.includes("B1") || cls.includes("3")) extractedData.license_class = "B1";
    else extractedData.license_class = "B";
    confidenceScores.license_class = 90;
  }

  return { extractedData, confidenceScores };
}

// Regex rules for Back of LTO Philippine Driver's License Card OCR (Filters out motorcycle disclaimer texts)
function parseDriverLicenseBackFieldsFromText(text) {
  if (!text) return { extractedData: {}, confidenceScores: {} };

  const extractedData = {};
  const confidenceScores = {};
  const cleanText = text.replace(/\r/g, "");

  // Filter text to start from IN CASE OF EMERGENCY to ignore top motorcycle disclaimers
  const emergencySectionIdx = cleanText.search(/IN\s*CASE\s*OF\s*EMERGENCY|EMERGENCY\s*NOTIFY|IN\s*CASE\s*OF/i);
  const targetText = emergencySectionIdx !== -1 ? cleanText.slice(emergencySectionIdx) : cleanText;

  // 1. TEL NO / Emergency Contact Phone Number
  const phoneMatch = targetText.match(/(?:TEL\.?\s*(?:NO\.?|NUMBER)?|PHONE|CELL|MOBILE|CONTACT\s*NO\.?)[:\s]*(\+?\d[\d\s-]{7,15})/i) ||
                     targetText.match(/\b(09\d{9}|09\d{2}[-\s]\d{3}[-\s]\d{4}|\+?639\d{9})\b/);
  if (phoneMatch) {
    extractedData.emergency_contact_phone = phoneMatch[1].replace(/\s+/g, "").trim();
    confidenceScores.emergency_contact_phone = 96;
  }

  // 2. NAME (Explicitly matching "NAME:" or line after "IN CASE OF EMERGENCY")
  const nameMatch = targetText.match(/(?:NAME|NOTIFY|CONTACT)[:\s]*([A-Z\s,]{3,40})/i);
  if (nameMatch) {
    let rawName = nameMatch[1].trim().toUpperCase();
    if (!/MOTORCYCLE|MOTORCYGLE|RESTRICTION|CONDITION|RULES|REGULATION|COMMISSION|AGENCY|DISCLAIMER|CLASS|CODE/i.test(rawName)) {
      rawName = rawName.split(/\s+(?:TEL|PHONE|MOBILE|ADDRESS|NO|CONTACT)[:\s]/i)[0].trim();
      if (rawName.length >= 3) {
        extractedData.emergency_contact_name = rawName;
        confidenceScores.emergency_contact_name = 95;
      }
    }
  }

  // 3. ADDRESS (Explicitly matching "ADDRESS:" and applying spelling autocorrect)
  const addrMatch = targetText.match(/(?:ADDRESS|ADD?\.?)[:\s]*([^\n\r]+)/i);
  if (addrMatch) {
    let rawAddr = addrMatch[1].trim().toUpperCase();
    if (!/MOTORCYCLE|MOTORCYGLE|RESTRICTION|CONDITION|RULES|REGULATION|COMMISSION|AGENCY|DISCLAIMER/i.test(rawAddr)) {
      rawAddr = rawAddr.split(/\s+(?:TEL|PHONE|MOBILE|NO|CONTACT)[:\s]/i)[0].trim();
      rawAddr = rawAddr.replace(/^[^A-Za-z0-9]+/, "").trim();
      if (rawAddr.length >= 3) {
        extractedData.emergency_contact_address = correctPhilippineAddressSpelling(rawAddr);
        confidenceScores.emergency_contact_address = 95;
      }
    }
  }

  return { extractedData, confidenceScores };
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
