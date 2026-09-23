// Tests for Philippine postal-code validation.
//
// The contract that matters here is the one the whole feature rests on:
// postal-code validity and LOCATION verification are separate facts. Nothing in
// this module may imply an address is (or is not) a real place — it only says
// whether a string is shaped like a ZIP code.
import { describe, it, expect } from "vitest";
import { normalizePostalCode, isPhPostalCode, postalCodeError } from "./postal";

describe("normalizePostalCode", () => {
  it("trims and passes through a well-formed code", () => {
    expect(normalizePostalCode("1421")).toBe("1421");
    expect(normalizePostalCode("  1421  ")).toBe("1421");
    expect(normalizePostalCode("1000")).toBe("1000");
  });

  it("collapses every empty-ish input to a single null", () => {
    expect(normalizePostalCode("")).toBeNull();
    expect(normalizePostalCode("   ")).toBeNull();
    expect(normalizePostalCode(null)).toBeNull();
    expect(normalizePostalCode(undefined)).toBeNull();
  });
});

describe("isPhPostalCode", () => {
  it("accepts four-digit codes", () => {
    expect(isPhPostalCode("1421")).toBe(true);
    expect(isPhPostalCode("1000")).toBe(true);
    expect(isPhPostalCode(1421)).toBe(true);
  });

  it("rejects anything that is not exactly four digits", () => {
    expect(isPhPostalCode("142")).toBe(false);
    expect(isPhPostalCode("14211")).toBe(false);
    expect(isPhPostalCode("14a1")).toBe(false);
    expect(isPhPostalCode("1421 Metro Manila")).toBe(false);
    expect(isPhPostalCode("-1421")).toBe(false);
    expect(isPhPostalCode("")).toBe(false);
    expect(isPhPostalCode(null)).toBe(false);
  });
});

describe("postalCodeError", () => {
  it("is silent for a valid code and for no code at all", () => {
    // Absent is a state we DISPLAY ("ZIP code not provided"), not an error —
    // conflating the two would block saving a legitimately unknown ZIP.
    expect(postalCodeError("1421")).toBeNull();
    expect(postalCodeError("")).toBeNull();
    expect(postalCodeError(null)).toBeNull();
  });

  it("explains the format when a code is present but malformed", () => {
    expect(postalCodeError("142")).toMatch(/4 digits/);
    expect(postalCodeError("ABCD")).toMatch(/4 digits/);
  });
});
