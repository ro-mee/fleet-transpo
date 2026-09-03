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

function categoryLabel(value) {
  if (typeof value !== "string") return "Other";
  const text = value.trim().toLowerCase();
  if (!text) return "Other";
  if (text.includes("toll")) return "Toll";
  if (text.includes("park")) return "Parking";
  if (text.includes("meal") || text.includes("food") || text.includes("restaurant") || text.includes("cafe")) return "Meals";
  if (text.includes("hotel") || text.includes("lodging") || text.includes("inn")) return "Lodging";
  return "Other";
}

export function normalizeGeminiExpenseReceipt(data = {}) {
  const merchant = typeof data.merchant === "string" ? data.merchant.trim().slice(0, 255) : null;
  return {
    merchant_name: merchant,
    amount: validNumber(data.amount, 1000000),
    expense_date: validDate(data.expense_date),
    expense_time: typeof data.expense_time === "string" ? data.expense_time.slice(0, 8) : null,
    inferred_category: categoryLabel(data.inferred_category),
    confidence: validNumber(data.confidence, 1) ?? null,
  };
}

export function parseGeminiExpenseReceiptResponse(response) {
  const text = response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no receipt data.");
  return normalizeGeminiExpenseReceipt(JSON.parse(text));
}

export async function scanExpenseReceiptWithGemini(fileBuffer, contentType) {
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
            text: `Read this Philippine expense receipt and return only the requested fields.
- merchant: merchant name or business name (e.g., Skyway, SM City Parking, Jollibee). Use null if unreadable.
- amount: final amount paid or TOTAL INVOICE after discounts. Use null if unreadable.
- expense_date: transaction date as YYYY-MM-DD. Use null if unreadable.
- expense_time: transaction time as HH:MM. Use null if unreadable.
- inferred_category: guess the category (Toll, Parking, Meals, Lodging, Other).
- confidence: a number between 0.0 and 1.0 indicating your confidence in the extraction.
Do not calculate or guess unreadable values.`,
          },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            merchant: { type: "STRING", nullable: true },
            amount: { type: "NUMBER", nullable: true },
            expense_date: { type: "STRING", nullable: true },
            expense_time: { type: "STRING", nullable: true },
            inferred_category: { type: "STRING", nullable: true },
            confidence: { type: "NUMBER", nullable: true },
          },
          required: ["amount", "inferred_category"],
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
        return { extractedData: parseGeminiExpenseReceiptResponse(await response.json()), model };
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
