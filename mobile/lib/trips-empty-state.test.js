import { describe, it, expect } from "vitest";
import { DUTY_EMPTY_STATES, resolveDutyEmptyState } from "./duty-empty-states";

describe("Trips Tab Empty State Logic", () => {
  it("resolves Off Duty empty state when driver is not checked in", () => {
    const key = resolveDutyEmptyState({
      duty: { loaded: true, checkedIn: false, today: { blocked: false } },
    });
    expect(key).toBe("off_duty");
    expect(DUTY_EMPTY_STATES[key].tripsTitle).toBe("You’re Off Duty");
    expect(DUTY_EMPTY_STATES[key].tripsDescription).toBe("Trip queue will activate once your shift begins.");
  });

  it("resolves Rest Day empty state when scheduled as rest day", () => {
    const key = resolveDutyEmptyState({
      duty: { loaded: true, checkedIn: false, today: { blocked: true, reason: "Rest Day" } },
    });
    expect(key).toBe("rest_day");
    expect(DUTY_EMPTY_STATES[key].tripsTitle).toBe("Today is Your Rest Day");
    expect(DUTY_EMPTY_STATES[key].tripsDescription).toBe("No operational trips are scheduled for you today.");
  });

  it("resolves On Leave empty state when on approved leave", () => {
    const key = resolveDutyEmptyState({
      duty: { loaded: true, checkedIn: false, today: { blocked: true, reason: "Approved Leave" } },
    });
    expect(key).toBe("on_leave");
    expect(DUTY_EMPTY_STATES[key].tripsTitle).toBe("You’re Currently on Leave");
    expect(DUTY_EMPTY_STATES[key].tripsDescription).toBe("Trip assignments will resume when you return to active duty.");
  });

  it("returns null when on duty standby, keeping operational radar active", () => {
    const key = resolveDutyEmptyState({
      duty: { loaded: true, checkedIn: true, today: { blocked: false } },
      profile: { driverStatus: "Available" },
    });
    expect(key).toBeNull();
  });
});
