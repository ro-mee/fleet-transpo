import { describe, it, expect } from "vitest";
import { validateOdometerReading, MAX_PLAUSIBLE_TRIP_KM } from "@/lib/vehicles/odometer";

describe("validateOdometerReading", () => {
  it("accepts a reading above the current mileage", () => {
    const r = validateOdometerReading({ reading: 50120, currentMileage: 50000 });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(false);
  });

  it("accepts a reading equal to the current mileage", () => {
    // A trip that moved the vehicle nowhere is odd but not invalid, and
    // rejecting it would block a legitimate cancelled-at-the-gate completion.
    const r = validateOdometerReading({ reading: 50000, currentMileage: 50000 });
    expect(r.ok).toBe(true);
  });

  it("rejects a reading below the current mileage", () => {
    // Accepting this would silently defer every due-date on the vehicle.
    const r = validateOdometerReading({ reading: 49000, currentMileage: 50000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/below/i);
    expect(r.error).toMatch(/50,?000/);
  });

  it("flags an implausible jump without rejecting it", () => {
    // Long provincial transfers happen. Flag for review, do not block the trip.
    const r = validateOdometerReading({ reading: 50000 + MAX_PLAUSIBLE_TRIP_KM + 1, currentMileage: 50000 });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(true);
    expect(r.reason).toMatch(/1,?500/);
  });

  it("does not flag a jump exactly at the threshold", () => {
    const r = validateOdometerReading({ reading: 50000 + MAX_PLAUSIBLE_TRIP_KM, currentMileage: 50000 });
    expect(r.flagged).toBe(false);
  });

  it("rejects a missing or non-numeric reading", () => {
    expect(validateOdometerReading({ reading: undefined, currentMileage: 50000 }).ok).toBe(false);
    expect(validateOdometerReading({ reading: null, currentMileage: 50000 }).ok).toBe(false);
    expect(validateOdometerReading({ reading: "abc", currentMileage: 50000 }).ok).toBe(false);
  });

  it("rejects a negative reading", () => {
    expect(validateOdometerReading({ reading: -5, currentMileage: 0 }).ok).toBe(false);
  });

  it("accepts any reading when the vehicle has no recorded mileage", () => {
    // A brand-new vehicle row has mileage 0 or NULL; there is nothing to
    // regress against and the first reading establishes the baseline.
    expect(validateOdometerReading({ reading: 120, currentMileage: null }).ok).toBe(true);
    expect(validateOdometerReading({ reading: 120, currentMileage: undefined }).ok).toBe(true);
  });

  it("coerces numeric strings, which is what a JSON body carries", () => {
    const r = validateOdometerReading({ reading: "50120", currentMileage: "50000" });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(false);
  });
});
