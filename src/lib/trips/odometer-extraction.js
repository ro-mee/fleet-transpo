/** Normalize only explicit visible total-kilometre readings; never infer digits. */
export function normalizeOdometerExtraction(data) {
  const value = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const readingText = typeof value.reading_text === "string" && /^\d{1,12}(?:\.\d{1,2})?$/.test(value.reading_text) ? value.reading_text : null;
  const unit = ["km", "mi", "unknown"].includes(value.unit) ? value.unit : "unknown";
  const displayKind = ["total", "trip", "unclear"].includes(value.display_kind) ? value.display_kind : "unclear";
  const number = readingText === null ? null : Number(readingText);
  const usable = value.readable === true && displayKind === "total" && unit === "km" && number > 0 && number <= 2000000;
  return {
    readingText,
    readingKm: usable ? number : null,
    unit,
    displayKind,
    failureCode: usable ? null : unit === "mi" ? "ODOMETER_UNIT_UNSUPPORTED" : "ODOMETER_RETAKE_REQUIRED",
  };
}

export function parseGeminiOdometerResponse(response) {
  const candidate = response?.candidates?.[0];
  if (response?.promptFeedback?.blockReason || candidate?.finishReason !== "STOP" || !Array.isArray(candidate?.content?.parts)) {
    return normalizeOdometerExtraction(null);
  }
  const parts = candidate.content.parts.filter((part) => !part?.thought);
  if (parts.length !== 1 || typeof parts[0]?.text !== "string") return normalizeOdometerExtraction(null);
  try {
    return normalizeOdometerExtraction(JSON.parse(parts[0].text));
  } catch {
    return normalizeOdometerExtraction(null);
  }
}
