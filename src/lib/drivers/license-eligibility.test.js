import { describe, expect, it } from "vitest";
import {
  evaluateDriverLicenseEligibility,
  formatLicenseClasses,
  isValidLicenseExpiry,
  isValidLicenseNumber,
  licenseNumberEvidence,
  licenseExpiryIsBefore,
  maskLicenseNumber,
  normalizeLicenseClasses,
  validateLicenseDetails,
} from "./license-eligibility";

const DRIVER = {
  license_number: "N04-19-013583",
  license_type: "Professional",
  license_class: "B",
  license_expiry: "2030-01-01",
  license_verified_at: "2026-09-27T10:00:00+08:00",
  license_verified_by: 7,
  license_verification_method: "physical_card",
};
const VEHICLE = { required_license_class: "B" };

describe("license number and class normalization", () => {
  it("checks basic syntax without treating a valid shape as proof of authenticity", () => {
    expect(isValidLicenseNumber("N04-19-013583")).toBe(true);
    expect(isValidLicenseNumber("N04-19-01!583")).toBe(false);
    expect(isValidLicenseNumber("   ")).toBe(false);
  });

  it("accepts only the license classes the driver forms currently support", () => {
    expect(normalizeLicenseClasses("B, B1")).toEqual(["B", "B1"]);
    expect(formatLicenseClasses("B1 / B")).toBe("B, B1");
    expect(normalizeLicenseClasses("C")).toBeNull();
  });
});

describe("evaluateDriverLicenseEligibility", () => {
  it("blocks a Student Permit", () => {
    const result = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_type: "Student Permit" },
      VEHICLE,
      "2026-09-27"
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Student Permit is not eligible for driving assignments.");
  });

  it("blocks expired licenses but treats expiry day as valid through that Manila date", () => {
    expect(licenseExpiryIsBefore("2026-09-26", "2026-09-27")).toBe(true);
    expect(licenseExpiryIsBefore("2026-09-27", "2026-09-27")).toBe(false);
    expect(licenseExpiryIsBefore("2026-09-27", "2026-02-30")).toBe(false);
    expect(licenseExpiryIsBefore("2026-09-27", "2026-09-26T16:00:00.000Z")).toBe(false);
    expect(licenseExpiryIsBefore("2026-09-26", "2026-09-26T16:00:00.000Z")).toBe(true);
    expect(evaluateDriverLicenseEligibility(
      { ...DRIVER, license_expiry: "2026-09-27" },
      VEHICLE,
      "2026-09-27T15:59:59.000Z"
    ).eligible).toBe(true);
  });

  it("blocks a class that does not match the vehicle requirement", () => {
    const result = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_class: "B" },
      { required_license_class: "B1" },
      "2026-09-27"
    );
    expect(result.reason).toBe("License class does not cover this vehicle (requires B1).");
  });

  it("blocks missing or unsupported vehicle requirements and unsupported license types", () => {
    expect(evaluateDriverLicenseEligibility(DRIVER, {}, "2026-09-27").reasons)
      .toContain("Vehicle required license class is missing or unsupported.");
    expect(evaluateDriverLicenseEligibility(
      { ...DRIVER, license_type: "Non-Professional" }, VEHICLE, "2026-09-27"
    ).reasons).toContain("Unsupported license type; a Professional license is required for fleet driving.");
  });

  it("blocks missing, malformed, unsupported, and unverified details with actionable reasons", () => {
    const missing = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_number: "", license_expiry: null, license_verified_at: null },
      VEHICLE,
      "2026-09-27"
    );
    expect(missing.reasons).toContain("License number is missing.");
    expect(missing.reasons).toContain("License expiration date is missing or invalid.");
    expect(missing.reasons).toContain("License details have not been verified by authorized staff.");

    const malformed = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_number: "N04-19-01!583" },
      VEHICLE,
      "2026-09-27"
    );
    expect(malformed.reasons).toContain("License number is malformed.");

    const unsupported = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_class: "C" },
      VEHICLE,
      "2026-09-27"
    );
    expect(unsupported.reasons).toContain("License class is missing or unsupported.");
  });

  it("does not treat a syntactically valid number as an authentic or active license", () => {
    const result = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_verified_at: null },
      VEHICLE,
      "2026-09-27"
    );
    expect(isValidLicenseNumber(DRIVER.license_number)).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("verified");
  });

  it("evaluates masked roster numbers without mistaking the mask for malformed data", () => {
    const result = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_number: "********3583" },
      VEHICLE,
      "2026-09-27"
    );
    expect(result.reasons).toContain("License number is malformed.");
    const checked = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_number: "********3583", license_number_valid: true },
      VEHICLE,
      "2026-09-27"
    );
    expect(checked.eligible).toBe(true);
  });

  it("uses number evidence in a redacted assignment row", () => {
    const { license_number: _number, ...redacted } = DRIVER;
    const valid = evaluateDriverLicenseEligibility(
      { ...redacted, ...licenseNumberEvidence(DRIVER.license_number) }, VEHICLE, "2026-09-27"
    );
    expect(valid.eligible).toBe(true);

    const malformed = evaluateDriverLicenseEligibility(
      { ...redacted, ...licenseNumberEvidence("N04-19-01!583") }, VEHICLE, "2026-09-27"
    );
    expect(malformed.reasons).toContain("License number is malformed.");
    expect(malformed.reasons).not.toContain("License number is missing.");

    const missing = evaluateDriverLicenseEligibility(
      { ...redacted, ...licenseNumberEvidence(null) }, VEHICLE, "2026-09-27"
    );
    expect(missing.reasons).toContain("License number is missing.");
    expect(evaluateDriverLicenseEligibility(redacted, VEHICLE, "2026-09-27").reasons)
      .toContain("License number is missing.");
  });

  it("does not treat a masked value as a valid stored number on the server", () => {
    const result = evaluateDriverLicenseEligibility(
      { ...DRIVER, license_number: "********3583" },
      VEHICLE,
      "2026-09-27"
    );
    expect(result.reasons).toContain("License number is malformed.");
  });
});

describe("maskLicenseNumber", () => {
  it("retains only the final four characters", () => {
    expect(maskLicenseNumber("N04-19-013583")).toBe("********3583");
    expect(maskLicenseNumber(null)).toBeNull();
  });
});

describe("staff verification gate (RS-7C7G)", () => {
  it("accepts the Date objects node-postgres returns for DATE columns", () => {
    // Live rows arrive with license_expiry as a Date (local midnight), not a
    // YYYY-MM-DD string. The verify endpoint validates these same rows, so a
    // string-only check made verification impossible for every driver.
    const dbShaped = { ...DRIVER, license_expiry: new Date(2033, 5, 5) };
    expect(isValidLicenseExpiry(dbShaped.license_expiry)).toBe(true);
    expect(validateLicenseDetails(dbShaped, { requireAll: true })).toEqual({});
    expect(evaluateDriverLicenseEligibility(dbShaped, VEHICLE, "2026-09-27").eligible).toBe(true);
  });

  it("still rejects missing and unparseable expiries", () => {
    expect(isValidLicenseExpiry(null)).toBe(false);
    expect(isValidLicenseExpiry("not-a-date")).toBe(false);
    expect(isValidLicenseExpiry("2026-02-30")).toBe(false);
    expect(validateLicenseDetails({ ...DRIVER, license_expiry: null }, { requireAll: true }).license_expiry).toBeTruthy();
    expect(validateLicenseDetails({ ...DRIVER, license_expiry: "not-a-date" }, { requireAll: true }).license_expiry).toBeTruthy();
  });
});
