import { describe, it, expect } from "vitest";
import { deriveNextSchedule } from "@/services/maintenance-schedule.service";

describe("deriveNextSchedule", () => {
  it("advances both dimensions from the interval", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 50200,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.last_service_date).toBe("2026-08-04");
    expect(out.next_service_date).toBe("2027-01-31"); // 2026-08-04 + 180 days
    expect(out.next_service_mileage).toBe(55000);      // mileage AT service + 5000
  });

  it("measures the next service mileage from the service, not from today", () => {
    // The vehicle kept driving after the service. Basing the next interval on
    // current mileage would give away every kilometre driven since, shortening
    // the interval by exactly the delay in recording the record.
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 53000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.next_service_mileage).toBe(55000);
  });

  it("falls back to current mileage when the service record has none", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: null,
      currentMileage: 53000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.next_service_mileage).toBe(58000);
  });

  it("leaves the mileage dimension null when no km interval is set", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: 180,
      intervalKm: null,
    });
    expect(out.next_service_mileage).toBeNull();
    expect(out.next_service_date).toBe("2027-01-31");
  });

  it("leaves the date dimension null when no day interval is set", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: null,
      intervalKm: 5000,
    });
    expect(out.next_service_date).toBeNull();
    expect(out.next_service_mileage).toBe(55000);
  });

  it("still records the service date when both intervals are null", () => {
    // The service happened; last_service_date is a fact regardless of whether
    // a following one can be derived.
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: null,
      intervalKm: null,
    });
    expect(out.last_service_date).toBe("2026-08-04");
    expect(out.next_service_date).toBeNull();
    expect(out.next_service_mileage).toBeNull();
  });

  it("normalises a timestamp completed date to a calendar day", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04T13:45:00Z",
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.last_service_date).toBe("2026-08-04");
    expect(out.next_service_date).toBe("2027-01-31");
  });

  it("normalises a Date at local midnight, as pg returns a DATE column", () => {
    // The production path. pg hands `completed_date` back as a JS Date pinned to
    // *local* midnight, so this exercises toCalendarDay's Date branch — the one
    // every other fixture here skips by passing a string. Built from local
    // components deliberately: `new Date("2026-08-04T00:00:00Z")` is the
    // previous day at negative offsets.
    //
    // This is the test that fails if addDays is ever switched to
    // `.toISOString().slice(0, 10)`, which shifts the day backward at positive
    // offsets and sets every derived due-date one day early at UTC+8.
    const out = deriveNextSchedule({
      completedDate: new Date(2026, 7, 4),
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.last_service_date).toBe("2026-08-04");
    expect(out.next_service_date).toBe("2027-01-31");
  });

  it("returns null throughout when there is no completed date", () => {
    const out = deriveNextSchedule({
      completedDate: null,
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.last_service_date).toBeNull();
    expect(out.next_service_date).toBeNull();
    expect(out.next_service_mileage).toBeNull();
  });
});
