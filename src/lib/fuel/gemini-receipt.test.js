import { describe, expect, it } from "vitest";
import { normalizeGeminiFuelReceipt, parseGeminiFuelReceiptResponse } from "./gemini-receipt";

describe("Gemini fuel receipt output", () => {
  it("normalizes a structured Skyewin result", () => {
    expect(parseGeminiFuelReceiptResponse({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        station_name: "SKYEWIN PRIME RESOURCES, INC.",
        liters: 32.362,
        price_per_liter: 61.8,
        amount: 1760,
        fuel_date: "2024-10-01",
      }) }] } }],
    })).toEqual({
      station_name: "SHELL",
      liters: 32.362,
      price_per_liter: 61.8,
      amount: 1760,
      fuel_date: "2024-10-01",
      fuel_type: null,
    });
  });

  it("rejects guessed or invalid values", () => {
    expect(normalizeGeminiFuelReceipt({ station_name: "ERJ GASOLINE STATION", liters: "many", amount: 0, fuel_date: "2026-02-30" }))
      .toEqual({ station_name: null, liters: null, price_per_liter: null, amount: null, fuel_date: null, fuel_type: null });
  });

  it("normalizes the stated fuel product to a canonical label", () => {
    expect(normalizeGeminiFuelReceipt({ fuel_type: "  diesel " }).fuel_type).toBe("Diesel");
    expect(normalizeGeminiFuelReceipt({ fuel_type: "Unleaded (Gasoline)" }).fuel_type).toBe("Gasoline");
    expect(normalizeGeminiFuelReceipt({ fuel_type: "PETROL" }).fuel_type).toBe("Gasoline");
    expect(normalizeGeminiFuelReceipt({ fuel_type: "deisel" }).fuel_type).toBe("Diesel");
  });

  it("returns null for absent or meaningless fuel types", () => {
    expect(normalizeGeminiFuelReceipt({}).fuel_type).toBeNull();
    expect(normalizeGeminiFuelReceipt({ fuel_type: "LUBRICANTS AND ACCESSORIES" }).fuel_type).toBeNull();
    expect(normalizeGeminiFuelReceipt({ fuel_type: 123 }).fuel_type).toBeNull();
  });
});
