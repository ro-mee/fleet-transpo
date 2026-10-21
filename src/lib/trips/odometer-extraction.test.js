import { describe, expect, it } from "vitest";
import { normalizeOdometerExtraction, parseGeminiOdometerResponse } from "./odometer-extraction";

const clear = { reading_text: "025000", unit: "km", display_kind: "total", readable: true };
describe("odometer extraction", () => {
  it("handles null provider parts safely", () => {
    expect(parseGeminiOdometerResponse({ candidates: [{ finishReason: "STOP", content: { parts: [null] } }] }).readingKm).toBeNull();
  });
  it.each([["025000", 25000], ["25000.1", 25000.1], ["25000.12", 25000.12], ["2000000", 2000000]])("preserves visible digits %s", (reading_text, readingKm) => {
    expect(normalizeOdometerExtraction({ ...clear, reading_text })).toEqual({ readingText: reading_text, readingKm, unit: "km", displayKind: "total", failureCode: null });
  });
  it.each([true, [], 25000, "1e4", "-1", "0", "2000000.01", "12 km", "12.123", " 12", "12,000", null])("rejects ambiguous reading %j", (reading_text) => {
    expect(normalizeOdometerExtraction({ ...clear, reading_text }).readingKm).toBeNull();
  });
  it.each([{ display_kind: "trip" }, { display_kind: "unclear" }, { readable: false }, { readable: "true" }, { unit: undefined }, { unit: [] }])("requires clear total km %j", (fields) => {
    expect(normalizeOdometerExtraction({ ...clear, ...fields }).failureCode).toBe("ODOMETER_RETAKE_REQUIRED");
  });
  it("does not convert miles", () => {
    expect(normalizeOdometerExtraction({ ...clear, unit: "mi" })).toMatchObject({ readingKm: null, failureCode: "ODOMETER_UNIT_UNSUPPORTED" });
  });
  it.each([null, [], true, {}])("handles malformed object %j", (data) => {
    expect(normalizeOdometerExtraction(data).readingKm).toBeNull();
  });
  it("parses one completed structured response", () => {
    expect(parseGeminiOdometerResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(clear) }] } }] }).readingKm).toBe(25000);
  });
  it.each(["", "{", "true", "[]", "null"])("rejects completed malformed JSON data %s", (text) => {
    expect(parseGeminiOdometerResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }).readingKm).toBeNull();
  });
  it.each([{ parts: [null] }, { parts: [{ text: JSON.stringify(clear) }, { text: JSON.stringify(clear) }] }, { parts: [{ text: JSON.stringify(clear), thought: true }] }])("rejects malformed or multiple output parts", ({ parts }) => {
    expect(parseGeminiOdometerResponse({ candidates: [{ finishReason: "STOP", content: { parts } }] }).readingKm).toBeNull();
  });
  it.each([{}, { candidates: [] }, { promptFeedback: { blockReason: "SAFETY" } }, { candidates: [{ finishReason: "SAFETY" }] }, { candidates: [{ content: { parts: [{ text: "{" }] } }] }, { candidates: [{ content: { parts: [{ text: "" }] } }] }])("rejects empty, refused or malformed provider output", (response) => {
    expect(parseGeminiOdometerResponse(response)).toMatchObject({ readingKm: null, failureCode: "ODOMETER_RETAKE_REQUIRED" });
  });
});
