import { getActiveAiProvider } from "@/lib/ai/llm-adapter";

const MODEL_FALLBACK = "gemini-3.1-flash-lite";
const SCAN_TIMEOUT_MS = 12000;

const MONTHS = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

function isoFromParts(year, month, day) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  const value = `${y}-${m}-${d}`;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

export function validScanDate(value) {
  const s = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;

  let m = s.match(/^((?:19|20)\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return isoFromParts(m[1], parseInt(m[2], 10), parseInt(m[3], 10));

  m = s.match(/^(\d{1,2})\s+([A-Z]{3,9})\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3)]) {
    return isoFromParts(m[3], MONTHS[m[2].slice(0, 3)], parseInt(m[1], 10));
  }
  m = s.match(/^([A-Z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3)]) {
    return isoFromParts(m[3], MONTHS[m[1].slice(0, 3)], parseInt(m[2], 10));
  }

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](19\d{2}|20\d{2})$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 12 && b <= 12) return isoFromParts(m[3], b, a);
    if (b > 12 && a <= 12) return isoFromParts(m[3], a, b);
    if (a <= 12 && b <= 12) return isoFromParts(m[3], a, b);
    return null;
  }

  return null;
}

function text(value, max = 255) {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
}

function upperText(value, max = 255) {
  return text(value, max)?.toUpperCase() || null;
}

function scanSex(value) {
  const s = String(value ?? "").trim().toUpperCase();
  if (/^F(EMALE)?$/.test(s)) return "F";
  if (/^M(ALE)?$/.test(s)) return "M";
  return null;
}

function scanYear(value) {
  const n = Number(value);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(n) || n < 1950 || n > currentYear + 1) return null;
  return n;
}

function scanCapacity(value) {
  const n = Number(String(value ?? "").replace(/[^\d]/g, ""));
  if (!Number.isInteger(n) || n < 1 || n > 60) return null;
  return n;
}

function scanPhone(value) {
  let s = String(value ?? "").replace(/[\s()\-.]/g, "").trim();
  s = s.replace(/^(011|00)/, "+");
  if (/^\+63\d{10}$/.test(s)) s = `0${s.slice(3)}`;
  if (!/^(\+63\d{10}|09\d{9}|\d{7,10})$/.test(s)) return null;
  return s;
}

function scanFuelType(value) {
  const s = String(value ?? "").trim().toUpperCase();
  if (!s) return null;
  if (/^(GASOLINE|GAS|PREMIUM)/.test(s)) return "Gasoline";
  if (/^DIESEL/.test(s)) return "Diesel";
  if (/^ELECTRIC|^EV$/.test(s)) return "Electric";
  if (/^(HYBRID|PHEV|HEV)$/.test(s)) return "Hybrid";
  return null;
}

function normalizeLicenseFront(data = {}) {
  return {
    document_is_license_card:
      typeof data.document_is_license_card === "boolean" ? data.document_is_license_card : null,
    license_number: upperText(data.license_number, 30),
    first_name: upperText(data.first_name),
    middle_name: upperText(data.middle_name),
    last_name: upperText(data.last_name),
    address: text(data.address, 500),
    birthdate: validScanDate(data.birthdate),
    sex: scanSex(data.sex),
    nationality: upperText(data.nationality),
    expiration_date: validScanDate(data.expiration_date),
    license_class: upperText(data.license_class, 10),
  };
}

function normalizeLicenseBack(data = {}) {
  return {
    document_is_license_card:
      typeof data.document_is_license_card === "boolean" ? data.document_is_license_card : null,
    emergency_contact_name: text(data.emergency_contact_name, 120),
    emergency_contact_phone: scanPhone(data.emergency_contact_phone),
    emergency_contact_address: text(data.emergency_contact_address, 500),
  };
}

function normalizeOrCr(data = {}) {
  return {
    plate_number: upperText(data.plate_number, 15),
    registration_number: upperText(data.registration_number, 40),
    manufacturer: upperText(data.manufacturer, 60),
    model: upperText(data.model, 60),
    series: upperText(data.series, 60),
    year: scanYear(data.year),
    color: upperText(data.color, 40),
    fuel_type: scanFuelType(data.fuel_type),
    seating_capacity: scanCapacity(data.seating_capacity),
    vehicle_name: upperText(data.vehicle_name, 60),
    expiration_date: validScanDate(data.expiration_date),
  };
}

function normalizeInsurance(data = {}) {
  return {
    insurance_policy_number: upperText(data.insurance_policy_number, 60),
    insurer_name: text(data.insurer_name, 120),
    expiration_date: validScanDate(data.expiration_date),
  };
}

const NORMALIZERS = {
  Driver_License: normalizeLicenseFront,
  Driver_License_Back: normalizeLicenseBack,
  OR_CR: normalizeOrCr,
  Insurance: normalizeInsurance,
};

export function normalizeGeminiDocument(documentType, data = {}) {
  const normalize = NORMALIZERS[documentType];
  if (!normalize) throw new Error(`Unsupported document type: ${documentType}`);
  return normalize(data);
}

const SCHEMAS = {
  Driver_License: {
    type: "OBJECT",
    properties: {
      document_is_license_card: { type: "BOOLEAN", nullable: true },
      license_number: { type: "STRING", nullable: true },
      first_name: { type: "STRING", nullable: true },
      middle_name: { type: "STRING", nullable: true },
      last_name: { type: "STRING", nullable: true },
      address: { type: "STRING", nullable: true },
      birthdate: { type: "STRING", nullable: true },
      sex: { type: "STRING", nullable: true },
      nationality: { type: "STRING", nullable: true },
      expiration_date: { type: "STRING", nullable: true },
      license_class: { type: "STRING", nullable: true },
    },
    required: [
      "document_is_license_card",
      "license_number",
      "first_name",
      "middle_name",
      "last_name",
      "address",
      "birthdate",
      "sex",
      "nationality",
      "expiration_date",
      "license_class",
    ],
  },
  Driver_License_Back: {
    type: "OBJECT",
    properties: {
      document_is_license_card: { type: "BOOLEAN", nullable: true },
      emergency_contact_name: { type: "STRING", nullable: true },
      emergency_contact_phone: { type: "STRING", nullable: true },
      emergency_contact_address: { type: "STRING", nullable: true },
    },
    required: ["document_is_license_card", "emergency_contact_name", "emergency_contact_phone", "emergency_contact_address"],
  },
  OR_CR: {
    type: "OBJECT",
    properties: {
      plate_number: { type: "STRING", nullable: true },
      registration_number: { type: "STRING", nullable: true },
      manufacturer: { type: "STRING", nullable: true },
      model: { type: "STRING", nullable: true },
      series: { type: "STRING", nullable: true },
      year: { type: "NUMBER", nullable: true },
      color: { type: "STRING", nullable: true },
      fuel_type: { type: "STRING", nullable: true },
      seating_capacity: { type: "NUMBER", nullable: true },
      vehicle_name: { type: "STRING", nullable: true },
      expiration_date: { type: "STRING", nullable: true },
    },
    required: [
      "plate_number",
      "registration_number",
      "manufacturer",
      "model",
      "series",
      "year",
      "color",
      "fuel_type",
      "seating_capacity",
      "vehicle_name",
      "expiration_date",
    ],
  },
  Insurance: {
    type: "OBJECT",
    properties: {
      insurance_policy_number: { type: "STRING", nullable: true },
      insurer_name: { type: "STRING", nullable: true },
      expiration_date: { type: "STRING", nullable: true },
    },
    required: ["insurance_policy_number", "insurer_name", "expiration_date"],
  },
};

const PROMPTS = {
  Driver_License: `Read this Philippine LTO driver's license card photo and return only the requested fields.
- document_is_license_card: true ONLY if the photo genuinely shows a Philippine LTO driver's license card (card-shaped ID with the driver's photo, "PHILIPPINES" and LTO / Land Transportation Office markings, printed personal details). Set false for printed paper, screenshots, notes, or any unrelated document.
- license_number: the License No., usually in the format A00-00-000000
- first_name / middle_name / last_name: split the printed name into its parts; never merge them
- address: the full residential address exactly as printed
- birthdate: date of birth as YYYY-MM-DD
- sex: single letter M or F only
- nationality: e.g. FILIPINO
- expiration_date: the card's expiration / valid-until date as YYYY-MM-DD, never the issue or AGO date
- license_class: the restrictions or codes value such as B, B1, B2, D; leave null if unclear
Use null for unreadable or absent values. Never guess, calculate, or invent values.`,
  Driver_License_Back: `Read the back of this Philippine LTO driver's license card photo and return only the requested fields.
- document_is_license_card: true ONLY if the photo shows the back of an LTO driver's license card (emergency contact block plus RESTRICTIONS/CONDITIONS codes section). Set false for printed paper, screenshots, notes, or any unrelated document.
Ignore all motorcycle disclaimer and restriction text at the top of the card.
- emergency_contact_name: the name under IN CASE OF EMERGENCY
- emergency_contact_phone: the TEL NO / contact number, digits with optional +63 prefix
- emergency_contact_address: the emergency contact's address exactly as printed
Use null for unreadable or absent values. Never guess, calculate, or invent values.`,
  OR_CR: `Read this Philippine LTO vehicle Official Receipt / Certificate of Registration photo and return only the requested fields.
- plate_number: the plate number such as ABC1234 or ABC 1234
- registration_number: the MV File Number when present, otherwise the CR or OR number
- manufacturer: brand/make only, e.g. TOYOTA; never the dealer name
- model: the model name, e.g. HIACE
- series: only when the document shows a separate SERIES or DENOMINATION line distinct from the model, e.g. COMMUTER; otherwise null
- year: the year model / year of manufacture as a number
- color: e.g. SILVER
- fuel_type: one of Gasoline, Diesel, Electric, Hybrid
- seating_capacity: passenger/seating capacity as a whole number between 1 and 60
- vehicle_name: body type / vehicle category, e.g. SEDAN, VAN, SUV, PICKUP
- expiration_date: registration expiry date as YYYY-MM-DD
Use null for unreadable or absent values. Never guess, calculate, or invent values.`,
  Insurance: `Read this Philippine vehicle insurance policy or certificate of cover photo and return only the requested fields.
- insurance_policy_number: the policy number, not the invoice or OR number
- insurer_name: the insurance company name, e.g. MALAYAN, FPG, PIONEER
- expiration_date: policy end / expiry date as YYYY-MM-DD
Use null for unreadable or absent values. Never guess, calculate, or invent values.`,
};

export function parseGeminiDocumentResponse(documentType, response) {
  const raw = response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!raw) throw new Error("Gemini returned no document data.");
  return normalizeGeminiDocument(documentType, JSON.parse(raw));
}

const MAX_SCAN_IMAGE_BYTES = 10 * 1024 * 1024;

export async function loadScanImage(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") {
    throw new Error("No document image was provided.");
  }

  if (fileUrl.startsWith("data:")) {
    const match = fileUrl.match(/^data:(image\/[\w+.-]+|application\/pdf);base64,(.+)$/s);
    if (!match) throw new Error("The document file could not be read. Use a PNG, JPG, or PDF.");
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.byteLength || buffer.byteLength > MAX_SCAN_IMAGE_BYTES) {
      throw new Error("Document image must be under 10 MB.");
    }
    return { buffer, contentType: match[1] };
  }

  const response = await fetch(fileUrl);
  const contentType = response.headers.get("content-type")?.split(";")[0] || "";
  if (!response.ok || !(contentType.startsWith("image/") || contentType === "application/pdf")) {
    throw new Error("The uploaded document file could not be read.");
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_SCAN_IMAGE_BYTES) {
    throw new Error("Document image must be under 10 MB.");
  }
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

export async function scanDocumentWithGemini(fileBuffer, contentType, documentType) {
  const prompt = PROMPTS[documentType];
  const schema = SCHEMAS[documentType];
  if (!prompt || !schema) throw new Error(`Unsupported document type: ${documentType}`);

  const provider = await getActiveAiProvider("Gemini");
  if (!provider?.api_key) throw new Error("Gemini is not configured.");

  const configuredModel = provider.model_name || "";
  const requestedModel = process.env.GEMINI_DOCUMENT_MODEL
    || (/^gemini-(?:2\.5|3(?:\.|$))/i.test(configuredModel) ? configuredModel : MODEL_FALLBACK);
  const models = requestedModel === MODEL_FALLBACK ? [MODEL_FALLBACK] : [requestedModel, MODEL_FALLBACK];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

  try {
    const requestBody = JSON.stringify({
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: contentType,
              data: Buffer.from(fileBuffer).toString("base64"),
            },
          },
          { text: prompt },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    let lastError;
    for (const model of models) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": provider.api_key,
        },
        signal: controller.signal,
        body: requestBody,
      });
      if (response.ok) {
        const extractedData = parseGeminiDocumentResponse(documentType, await response.json());
        return { extractedData, model };
      }
      const details = await response.text();
      lastError = new Error(`Gemini request failed (${response.status}): ${details.slice(0, 160)}`);
      if (response.status !== 404) break;
    }
    throw lastError;
  } finally {
    clearTimeout(timer);
  }
}
