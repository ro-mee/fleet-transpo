import { describe, it, expect } from "vitest";
import { completionDateRule, validateField, toProperCase, toVehicleTitleCase } from "@/lib/validation/helpers";
import { MAX_ODOMETER_KM } from "@/lib/vehicles/odometer";

/** Returns a YYYY-MM-DD string offset from today, staying in local calendar space. */
function dayOffset(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("completionDateRule", () => {
  it("accepts a date in the past", () => {
    expect(completionDateRule(dayOffset(-30))).toBeNull();
  });

  it("accepts today", () => {
    // A service completed this morning is the common case and must not be
    // rejected by an off-by-one comparison.
    expect(completionDateRule(dayOffset(0))).toBeNull();
  });

  it("rejects tomorrow", () => {
    expect(completionDateRule(dayOffset(1))).toMatch(/cannot be in the future/i);
  });

  it("rejects a far-future date", () => {
    // The case that matters: recomputeVehicleSchedule would turn this into the
    // vehicle's next_service_date under a forward-only clamp, taking the
    // vehicle out of the prediction permanently.
    expect(completionDateRule("2999-01-01")).toMatch(/cannot be in the future/i);
  });

  it("passes through an absent value, leaving required-ness to the field spec", () => {
    expect(completionDateRule("")).toBeNull();
    expect(completionDateRule(null)).toBeNull();
    expect(completionDateRule(undefined)).toBeNull();
  });

  it("passes through an unparseable value, leaving the format to the date check", () => {
    expect(completionDateRule("not-a-date")).toBeNull();
  });

  it("ignores the record's status, unlike maintenanceDateRule", () => {
    // maintenanceDateRule only bounds a date when status is Scheduled or
    // Completed. A completion date is nonsense in the future whatever the
    // status says, and the status field is client-supplied anyway.
    expect(completionDateRule(dayOffset(5), { status: "In Progress" })).toMatch(/cannot be in the future/i);
  });
});

describe("mileage bounds via validateField", () => {
  const spec = { type: "positiveNumber", label: "Mileage at service", max: MAX_ODOMETER_KM };

  it("accepts a realistic odometer reading", () => {
    expect(validateField(50000, spec, spec.label)).toBeNull();
  });

  it("accepts the ceiling itself", () => {
    expect(validateField(MAX_ODOMETER_KM, spec, spec.label)).toBeNull();
  });

  it("rejects a reading above the ceiling", () => {
    expect(validateField(MAX_ODOMETER_KM + 1, spec, spec.label)).toBeTruthy();
  });

  it("rejects a negative reading", () => {
    expect(validateField(-1, spec, spec.label)).toBeTruthy();
  });
});

describe("toProperCase — Standard Proper Case", () => {
  it("title-cases all-caps names", () => {
    expect(toProperCase("TEST DRIVER")).toBe("Test Driver");
  });

  it("title-cases lowercase names", () => {
    expect(toProperCase("jack mors")).toBe("Jack Mors");
  });

  it("title-cases mixed/multi-word names", () => {
    expect(toProperCase("KARLO RAFAEL SUNGA TORRES")).toBe("Karlo Rafael Sunga Torres");
  });

  it("preserves an existing proper-cased surname particle", () => {
    expect(toProperCase("Dela Cruz")).toBe("Dela Cruz");
  });

  it("handles an apostrophe name", () => {
    expect(toProperCase("O'NEILL")).toBe("O'Neill");
  });

  it("handles a hyphenated name", () => {
    expect(toProperCase("juan-carlos")).toBe("Juan-Carlos");
  });

  it("collapses stray whitespace and trims", () => {
    expect(toProperCase("  karlo   torres  ")).toBe("Karlo Torres");
  });

  it("is a no-op on null/empty", () => {
    expect(toProperCase(null)).toBe("");
    expect(toProperCase("")).toBe("");
  });
});

describe("toVehicleTitleCase — vehicle names / models", () => {
  it("title-cases all-caps vehicle names", () => {
    expect(toVehicleTitleCase("SEDAN")).toBe("Sedan");
    expect(toVehicleTitleCase("LAMBO")).toBe("Lambo");
  });

  it("turns a hyphen into a space", () => {
    expect(toVehicleTitleCase("TEST-VEHICLE")).toBe("Test Vehicle");
  });

  it("keeps a known vehicle-type acronym uppercase", () => {
    expect(toVehicleTitleCase("SUV")).toBe("SUV");
    expect(toVehicleTitleCase("TOYOTA HIACE SUV")).toBe("Toyota Hiace SUV");
  });

  it("keeps a model identifier containing a digit verbatim", () => {
    expect(toVehicleTitleCase("CiviC18S")).toBe("CiviC18S");
  });

  it("title-cases manufacturers", () => {
    expect(toVehicleTitleCase("HONDA")).toBe("Honda");
    expect(toVehicleTitleCase("TOYOTA")).toBe("Toyota");
  });

  it("is a no-op on null/empty", () => {
    expect(toVehicleTitleCase(null)).toBe("");
    expect(toVehicleTitleCase("")).toBe("");
  });
});
