// Shared OCR + regex parsing for Philippine LTO driver's license scans.
//
// Originally defined inside the staff /api/ai/scan-document route, these pure
// helpers are shared with the driver-facing /api/driver/license-scan endpoint so
// the driver upload flow reads scans the same way staff does.

// Helper function to extract document text using Tesseract OCR
export async function extractTextFromImage(fileUrl) {
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

// Auto-correct common Philippine address OCR typos (e.g. MANIA -> MANILA)
export function correctPhilippineAddressSpelling(addressStr) {
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
export function parseDriverLicenseFieldsFromText(text) {
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
export function parseDriverLicenseBackFieldsFromText(text) {
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
