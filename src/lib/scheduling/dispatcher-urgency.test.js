import { describe, expect, it } from "vitest";
import { isPickupDueWithoutStart, isWithinUpcomingWindow } from "./dispatcher-urgency";

const NOW = new Date("2026-10-03T04:00:00.000Z");

describe("isWithinUpcomingWindow", () => {
  it("includes now and the exact 30-minute boundary", () => {
    expect(isWithinUpcomingWindow(NOW, NOW)).toBe(true);
    expect(isWithinUpcomingWindow(new Date(+NOW + 30 * 60_000), NOW)).toBe(true);
  });

  it("excludes past, later, and invalid timestamps", () => {
    expect(isWithinUpcomingWindow(new Date(+NOW - 1), NOW)).toBe(false);
    expect(isWithinUpcomingWindow(new Date(+NOW + 30 * 60_000 + 1), NOW)).toBe(false);
    expect(isWithinUpcomingWindow("not a date", NOW)).toBe(false);
  });
});

describe("isPastPickupWithoutStart", () => {
  const dispatch = (overrides = {}) => ({
    status: "Scheduled",
    vehicle_id: 3,
    driver_id: 8,
    scheduled_departure: new Date(+NOW - 1).toISOString(),
    latest_trip: null,
    ...overrides,
  });

  it("flags scheduled dispatches at or past pickup without start evidence", () => {
    expect(isPickupDueWithoutStart(dispatch(), NOW)).toBe(true);
    expect(isPickupDueWithoutStart(dispatch({ scheduled_departure: NOW.toISOString() }), NOW)).toBe(true);
  });

  it("ignores future, invalid-time, started, and non-scheduled dispatches", () => {
    expect(isPickupDueWithoutStart(dispatch({ scheduled_departure: new Date(+NOW + 1).toISOString() }), NOW)).toBe(false);
    expect(isPickupDueWithoutStart(dispatch({ scheduled_departure: "invalid" }), NOW)).toBe(false);
    expect(isPickupDueWithoutStart(dispatch({ actual_departure: NOW.toISOString() }), NOW)).toBe(false);
    expect(isPickupDueWithoutStart(dispatch({ latest_trip: { start_time: NOW.toISOString() } }), NOW)).toBe(false);
    expect(isPickupDueWithoutStart(dispatch({ latest_trip: { trip_status: "Trip Started" } }), NOW)).toBe(false);
    expect(isPickupDueWithoutStart(dispatch({ driver_id: null }), NOW)).toBe(false);
    expect(isPickupDueWithoutStart(dispatch({ status: "In Progress" }), NOW)).toBe(false);
    expect(isPickupDueWithoutStart(dispatch({ status: "Completed" }), NOW)).toBe(false);
    expect(isPickupDueWithoutStart(dispatch({ status: "Cancelled" }), NOW)).toBe(false);
  });
});
