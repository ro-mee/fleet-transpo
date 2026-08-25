import { describe, expect, it } from "vitest";
import { normalizeGaugeScan, parseGaugeScanResponse } from "./gemini-gauge";

describe("Gemini gauge scan normalization", () => {
  it("accepts a readable estimate and clamps it to a whole percent", () => {
    expect(normalizeGaugeScan({ gauge_readable: true, estimated_level_percent: 45.6 }))
      .toEqual({ gauge_readable: true, estimated_level_percent: 46 });
    expect(normalizeGaugeScan({ gauge_readable: true, estimated_level_percent: "50" }))
      .toEqual({ gauge_readable: true, estimated_level_percent: 50 });
  });

  it("fails closed when the gauge is unreadable", () => {
    expect(normalizeGaugeScan({ gauge_readable: false, estimated_level_percent: 45 }))
      .toEqual({ gauge_readable: false, estimated_level_percent: null });
    expect(normalizeGaugeScan({ gauge_readable: true, estimated_level_percent: null }))
      .toEqual({ gauge_readable: false, estimated_level_percent: null });
  });

  it("rejects impossible estimates instead of clamping them into lies", () => {
    expect(normalizeGaugeScan({ gauge_readable: true, estimated_level_percent: 140 }).estimated_level_percent).toBeNull();
    expect(normalizeGaugeScan({ gauge_readable: true, estimated_level_percent: -5 }).estimated_level_percent).toBeNull();
    expect(normalizeGaugeScan({}).gauge_readable).toBe(false);
  });

  it("parses the structured Gemini response", () => {
    expect(parseGaugeScanResponse({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        gauge_readable: true,
        estimated_level_percent: 25,
      }) }] } }],
    })).toEqual({ gauge_readable: true, estimated_level_percent: 25 });
  });
});
