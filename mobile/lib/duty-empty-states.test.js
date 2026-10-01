import { describe, it, expect } from "vitest";
import { DUTY_EMPTY_STATES, resolveDutyEmptyState } from "./duty-empty-states";

describe("Duty Empty States Specification and Gating", () => {
  it("defines exactly three empty states with contextual copy for Map, Trips, and Home", () => {
    expect(Object.keys(DUTY_EMPTY_STATES).sort()).toEqual([
      "off_duty",
      "on_leave",
      "rest_day",
    ]);

    // Off Duty
    expect(DUTY_EMPTY_STATES.off_duty).toMatchObject({
      key: "off_duty",
      statusPill: "OFF DUTY",
      mapTitle: "You’re Off Duty",
      mapDescription: "Live trip tracking becomes available when you start your shift.",
      tripsTitle: "You’re Off Duty",
      tripsDescription: "Trip queue will activate once your shift begins.",
      homeTitle: "You’re Off Duty",
      iconType: "off_duty",
    });

    // Rest Day
    expect(DUTY_EMPTY_STATES.rest_day).toMatchObject({
      key: "rest_day",
      statusPill: "REST DAY",
      mapTitle: "Today is Your Rest Day",
      mapDescription: "No operational map or trip tracking is needed today.",
      tripsTitle: "Today is Your Rest Day",
      tripsDescription: "No operational trips are scheduled for you today.",
      homeTitle: "Today is Your Rest Day",
      iconType: "rest_day",
    });

    // On Leave
    expect(DUTY_EMPTY_STATES.on_leave).toMatchObject({
      key: "on_leave",
      statusPill: "ON LEAVE",
      mapTitle: "You’re Currently on Leave",
      mapDescription: "Live trip tracking will be available when you return to active duty.",
      tripsTitle: "You’re Currently on Leave",
      tripsDescription: "Trip assignments will resume when you return to active duty.",
      homeTitle: "You’re Currently on Leave",
      iconType: "on_leave",
    });
  });

  describe("resolveDutyEmptyState logic", () => {
    it("evaluates On Leave with highest precedence", () => {
      expect(resolveDutyEmptyState({ profile: { driverStatus: "On Leave" } })).toBe("on_leave");
      expect(resolveDutyEmptyState({ user: { driver_status: "On Leave" } })).toBe("on_leave");
      expect(resolveDutyEmptyState({
        duty: { loaded: true, checkedIn: false, today: { blocked: true, reason: "Approved Leave" } },
      })).toBe("on_leave");
    });

    it("evaluates Rest Day with second precedence", () => {
      expect(resolveDutyEmptyState({ profile: { driverStatus: "Rest Day" } })).toBe("rest_day");
      expect(resolveDutyEmptyState({
        duty: { loaded: true, checkedIn: false, today: { blocked: true, reason: "Rest Day" } },
      })).toBe("rest_day");
    });

    it("evaluates Off Duty when driver is not checked in", () => {
      expect(resolveDutyEmptyState({ profile: { driverStatus: "Off Duty" } })).toBe("off_duty");
      expect(resolveDutyEmptyState({ user: { driver_status: "Off Duty" } })).toBe("off_duty");
      expect(resolveDutyEmptyState({
        duty: { loaded: true, checkedIn: false, today: { blocked: false } },
      })).toBe("off_duty");
    });

    it("returns null when an active trip is in-flight", () => {
      expect(resolveDutyEmptyState({
        duty: { loaded: true, checkedIn: false },
        activeTrip: { trip_id: 101, trip_status: "Dispatched" },
      })).toBeNull();
    });

    it("returns null when driver is checked in and on duty", () => {
      expect(resolveDutyEmptyState({
        duty: { loaded: true, checkedIn: true, today: { blocked: false } },
        profile: { driverStatus: "Available" },
      })).toBeNull();
    });

    it("supports query parameter overrides", () => {
      expect(resolveDutyEmptyState({ paramStatus: "off_duty" })).toBe("off_duty");
      expect(resolveDutyEmptyState({ paramStatus: "rest_day" })).toBe("rest_day");
      expect(resolveDutyEmptyState({ paramStatus: "on_leave" })).toBe("on_leave");
    });
  });
});
