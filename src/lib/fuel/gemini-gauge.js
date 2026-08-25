import { getActiveAiProvider } from "@/lib/ai/llm-adapter";

const MODEL_FALLBACK = "gemini-3.1-flash-lite";

/**
 * Fail-closed gauge scan normalization: an unreadable photo yields
 * { gauge_readable: false, estimated_level_percent: null } — never a guess.
 */
export function normalizeGaugeScan(data = {}) {
  const readable = data.gauge_readable === true;
  const rawValue = data.estimated_level_percent;
  const raw = rawValue == null || rawValue === ""
    ? NaN
    : Number(String(rawValue).replace(/,/g, ""));
  const estimate = readable && Number.isFinite(raw) && raw >= 0 && raw <= 100
    ? Math.round(raw)
    : null;
  return {
    gauge_readable: readable && estimate !== null,
    estimated_level_percent: estimate,
  };
}

export function parseGaugeScanResponse(response) {
  const text = response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no gauge data.");
  return normalizeGaugeScan(JSON.parse(text));
}

export async function scanFuelGaugeWithGemini(fileBuffer, contentType) {
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
            text: `This photo is supposed to show a vehicle dashboard fuel gauge.
- Find the FUEL level indicator. Dashboards also contain temperature, tachometer (RPM), and speed gauges — never confuse those with the fuel gauge. The fuel gauge is usually labeled with a fuel-pump icon and a scale from E (empty) to F (full).
- The gauge may be an analog needle between E and F, or a digital bar/segment display of lit blocks.
- gauge_readable: true only when the fuel indicator itself is clearly visible and its position can be judged; otherwise false.
- estimated_level_percent: your best single estimate of how full the tank reads, as a whole number from 0 to 100 (E = 0, halfway = 50, F = 100). For segmented bars, count lit segments over total segments.
Return null for estimated_level_percent whenever gauge_readable would be false. Never guess.`,
          },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            gauge_readable: { type: "BOOLEAN", nullable: false },
            estimated_level_percent: { type: "NUMBER", nullable: true },
          },
          required: ["gauge_readable", "estimated_level_percent"],
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
        return { extractedData: parseGaugeScanResponse(await response.json()), model };
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
