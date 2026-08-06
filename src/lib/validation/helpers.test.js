import { describe, it, expect } from "vitest";
import { completionDateRule, validateField } from "@/lib/validation/helpers";
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
