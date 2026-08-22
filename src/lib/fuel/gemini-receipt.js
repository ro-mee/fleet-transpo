import { getActiveAiProvider } from "@/lib/ai/llm-adapter";

const MODEL_FALLBACK = "gemini-3.1-flash-lite";

function validNumber(value, max) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 && number <= max ? number : null;
}

function validDate(value) {
  const match = String(value ?? "").match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[0]}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === match[0] ? match[0] : null;
}

function stationBrand(text) {
  if (/\b(?:SHELL|SKY\s*E?WIN)\b/i.test(text)) return "SHELL";
  return text.match(/\b(PETRON|CALTEX|PHOENIX|SEAOIL|UNIOIL|CLEANFUEL)\b/i)?.[1].toUpperCase() || null;
}

export function normalizeGeminiFuelReceipt(data = {}) {
  const station = typeof data.station_name === "string" ? data.station_name.trim().slice(0, 255) : "";
  return {
    station_name: stationBrand(station),
    liters: validNumber(data.liters, 1000),
    price_per_liter: validNumber(data.price_per_liter, 10000),
    amount: validNumber(data.amount, 1000000),
    fuel_date: validDate(data.fuel_date),
  };
}

export function parseGeminiFuelReceiptResponse(response) {
  const text = response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no receipt data.");
  return normalizeGeminiFuelReceipt(JSON.parse(text));
}

export async function scanFuelReceiptWithGemini(fileBuffer, contentType) {
  const provider = await getActiveAiProvider("Gemini");
  if (!provider?.api_key) throw new Error("Gemini is not configured.");

  const configuredModel = provider.model_name || "";
  const requestedModel = process.env.GEMINI_RECEIPT_MODEL
    || (/^gemini-(?:2\.5|3(?:\.|$))/i.test(configuredModel) ? configuredModel : MODEL_FALLBACK);
  const models = requestedModel === MODEL_FALLBACK ? [MODEL_FALLBACK] : [requestedModel, MODEL_FALLBACK];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

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
          {
            text: `Read this Philippine fuel receipt and return only the requested fields.
- station_name: fuel brand only, such as PETRON or SHELL; never return the dealer/operator name. Treat Skyewin Prime Resources receipts as SHELL
- fuel_date: transaction date as YYYY-MM-DD
- liters: fuel quantity/volume only
- price_per_liter: pump/unit price per liter
- amount: final amount paid or TOTAL INVOICE after discounts; do not use Sale Total when a discounted final invoice is present
Use null for unreadable or absent values. For Petron table rows, interpret Description / Qty / Price / Amount as liters / price_per_liter / amount. Do not calculate or guess unreadable values.`,
          },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            station_name: { type: "STRING", nullable: true },
            liters: { type: "NUMBER", nullable: true },
            price_per_liter: { type: "NUMBER", nullable: true },
            amount: { type: "NUMBER", nullable: true },
            fuel_date: { type: "STRING", nullable: true },
          },
          required: ["station_name", "liters", "price_per_liter", "amount", "fuel_date"],
        },
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
        return { extractedData: parseGeminiFuelReceiptResponse(await response.json()), model };
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
