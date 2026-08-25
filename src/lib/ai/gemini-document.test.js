import { describe, expect, it } from "vitest";
import {
  loadScanImage,
  normalizeGeminiDocument,
  parseGeminiDocumentResponse,
  validScanDate,
} from "./gemini-document";
import { evaluateLicenseScan } from "./license-scan-policy";

describe("loadScanImage", () => {
  it("decodes image and PDF data URLs", async () => {
    const png = await loadScanImage(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    );
    expect(png.contentType).toBe("image/png");
    expect(png.buffer.length).toBeGreaterThan(0);

    const pdf = await loadScanImage("data:application/pdf;base64,JVBERi0xLjQK");
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.buffer.toString("utf8").startsWith("%PDF")).toBe(true);
  });

  it("rejects unsupported or malformed data URLs", async () => {
    await expect(loadScanImage("data:text/plain;base64,aGk=")).rejects.toThrow(/could not be read/);
    await expect(loadScanImage("data:image/png,this-is-not-base64!!")).rejects.toThrow(/could not be read/);
  });
});

describe("Gemini document date parsing", () => {
  it("accepts ISO dates and validates the calendar", () => {
    expect(validScanDate("2026-08-25")).toBe("2026-08-25");
    expect(validScanDate("2026/8/5")).toBe("2026-08-05");
    expect(validScanDate("2026-02-30")).toBeNull();
  });

  it("accepts printed license formats without guessing", () => {
    expect(validScanDate("1990-01-31")).toBe("1990-01-31");
    expect(validScanDate("31 JAN 1990")).toBe("1990-01-31");
    expect(validScanDate("Jan. 31 1990")).toBe("1990-01-31");
    expect(validScanDate("31/12/1990")).toBe("1990-12-31");
    expect(validScanDate("12/31/1990")).toBe("1990-12-31");
    expect(validScanDate("13/13/1990")).toBeNull();
    expect(validScanDate("not a date")).toBeNull();
  });
});

describe("Gemini driver's license extraction", () => {
  it("normalizes a full front-of-card result", () => {
    expect(parseGeminiDocumentResponse("Driver_License", {
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        license_number: "n04-88-123456",
        first_name: "Juan",
        middle_name: "Reyes",
        last_name: "Dela Cruz",
        address: "123 Rizal St., Sampaloc, Manila",
        birthdate: "1990-01-31",
        sex: "MALE",
        nationality: "Filipino",
        expiration_date: "2031-01-30",
        license_class: "B",
      }) }] } }],
    })).toEqual({
      document_is_license_card: null,
      license_number: "N04-88-123456",
      first_name: "JUAN",
      middle_name: "REYES",
      last_name: "DELA CRUZ",
      address: "123 Rizal St., Sampaloc, Manila",
      birthdate: "1990-01-31",
      sex: "M",
      nationality: "FILIPINO",
      expiration_date: "2031-01-30",
      license_class: "B",
    });
  });

  it("keeps unreadable fields null instead of guessing", () => {
    expect(normalizeGeminiDocument("Driver_License", {
      sex: "X",
      birthdate: "31/02/1990",
      expiration_date: "",
      license_number: 42,
    })).toEqual({
      document_is_license_card: null,
      license_number: null,
      first_name: null,
      middle_name: null,
      last_name: null,
      address: null,
      birthdate: null,
      sex: null,
      nationality: null,
      expiration_date: null,
      license_class: null,
    });
  });

  it("normalizes emergency contact details from the card back", () => {
    expect(normalizeGeminiDocument("Driver_License_Back", {
      emergency_contact_name: "Maria Dela Cruz",
      emergency_contact_phone: "+63 917 123 4567",
      emergency_contact_address: "456 Mabini St., Quezon City ",
    })).toEqual({
      document_is_license_card: null,
      emergency_contact_name: "Maria Dela Cruz",
      emergency_contact_phone: "09171234567",
      emergency_contact_address: "456 Mabini St., Quezon City",
    });
  });

  it("rejects phone numbers that are not plausible contact numbers", () => {
    expect(normalizeGeminiDocument("Driver_License_Back", {
      emergency_contact_phone: "12345",
    })).toEqual({
      document_is_license_card: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      emergency_contact_address: null,
    });
  });
});

describe("Gemini OR/CR extraction", () => {
  it("normalizes vehicle fields with distinct model and series", () => {
    expect(normalizeGeminiDocument("OR_CR", {
      plate_number: "abc 1234",
      registration_number: "1301-0000000000",
      manufacturer: "Toyota",
      model: "Hiace",
      series: "Commuter",
      year: "2019",
      color: "Silver",
      fuel_type: "DIESEL",
      seating_capacity: "15 SEATERS",
      vehicle_name: "van",
      expiration_date: "2027/03/14",
    })).toEqual({
      plate_number: "ABC 1234",
      registration_number: "1301-0000000000",
      manufacturer: "TOYOTA",
      model: "HIACE",
      series: "COMMUTER",
      year: 2019,
      color: "SILVER",
      fuel_type: "Diesel",
      seating_capacity: 15,
      vehicle_name: "VAN",
      expiration_date: "2027-03-14",
    });
  });

  it("rejects implausible years and capacities", () => {
    expect(normalizeGeminiDocument("OR_CR", {
      year: 1899,
      seating_capacity: 99,
      fuel_type: "KEROSENE",
    })).toEqual({
      plate_number: null,
      registration_number: null,
      manufacturer: null,
      model: null,
      series: null,
      year: null,
      color: null,
      fuel_type: null,
      seating_capacity: null,
      vehicle_name: null,
      expiration_date: null,
    });
  });
});

describe("Gemini insurance extraction", () => {
  it("normalizes policy details", () => {
    expect(normalizeGeminiDocument("Insurance", {
      insurance_policy_number: "CTPL-2026-000111",
      insurer_name: "Malayan Insurance Co., Inc.",
      expiration_date: "Aug. 24, 2027",
    })).toEqual({
      insurance_policy_number: "CTPL-2026-000111",
      insurer_name: "Malayan Insurance Co., Inc.",
      expiration_date: "2027-08-24",
    });
  });
});

describe("license card authenticity flag", () => {
  it("passes the boolean through when Gemini returns one", () => {
    const parsed = parseGeminiDocumentResponse("Driver_License", {
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        document_is_license_card: false,
        license_number: "N04-88-123456",
        last_name: "Dela Cruz",
      }) }] } }],
    });
    expect(parsed.document_is_license_card).toBe(false);
  });

  it("is null (fail-closed) when missing", () => {
    const parsed = normalizeGeminiDocument("Driver_License_Back", {
      emergency_contact_name: "Maria",
    });
    expect(parsed.document_is_license_card).toBeNull();
  });
});

describe("evaluateLicenseScan policy", () => {
  const today = "2026-08-25";

  it("rejects anything that is not verified as a license card", () => {
    for (const flag of [false, null, undefined]) {
      const verdict = evaluateLicenseScan("front", {
        document_is_license_card: flag,
        license_number: "N04-88-123456",
        last_name: "Dela Cruz",
      }, { todayIso: today });
      expect(verdict.pass).toBe(false);
      expect(verdict.validationIssue).toMatch(/does not look like a Philippine LTO/i);
    }
  });

  it("rejects readable cards missing their side's key fields", () => {
    const front = evaluateLicenseScan("front", { document_is_license_card: true }, { todayIso: today });
    expect(front.pass).toBe(false);
    expect(front.validationIssue).toMatch(/Could not read/);

    const back = evaluateLicenseScan("back", { document_is_license_card: true }, { todayIso: today });
    expect(back.pass).toBe(false);
  });

  it("accepts a genuine front card and applies only future expiries", () => {
    const future = evaluateLicenseScan("front", {
      document_is_license_card: true,
      license_number: "N04-88-123456",
      expiration_date: "2031-01-30",
    }, { todayIso: today });
    expect(future).toEqual({ pass: true, validationIssue: null, applyExpiry: true, expiryDate: "2031-01-30" });

    const past = evaluateLicenseScan("front", {
      document_is_license_card: true,
      license_number: "N04-88-123456",
      expiration_date: "2020-01-30",
    }, { todayIso: today });
    expect(past.pass).toBe(true);
    expect(past.applyExpiry).toBe(false);

    const back = evaluateLicenseScan("back", {
      document_is_license_card: true,
      emergency_contact_phone: "09171234567",
      expiration_date: "2031-01-30",
    }, { todayIso: today });
    expect(back.pass).toBe(true);
    expect(back.applyExpiry).toBe(false);
  });
});
