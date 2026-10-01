import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect } from "vitest";

const source = readFileSync("mobile/app/(app)/(tabs)/map.js", "utf8");

// Extract MAP_EMPTY_STATES and resolveMapEmptyState from map.js to test in isolated VM context
const emptyStatesMatch = source.match(/export const MAP_EMPTY_STATES = ([\s\S]*?^};)/m);
const resolverMatch = source.match(/export function resolveMapEmptyState\(([\s\S]*?^})/m);

const context = vm.createContext({});
if (emptyStatesMatch) {
  vm.runInContext(`this.MAP_EMPTY_STATES = ${emptyStatesMatch[1]}`, context);
}
if (resolverMatch) {
  vm.runInContext(`this.resolveMapEmptyState = function(${resolverMatch[1]}`, context);
}

describe("Map Tab Empty States — Specification and Gating", () => {
  it("defines exactly three empty states with required copy and visual tokens", () => {
    const { MAP_EMPTY_STATES } = context;
    expect(MAP_EMPTY_STATES).toBeDefined();

    // Exactly three empty states
    expect(Object.keys(MAP_EMPTY_STATES).sort()).toEqual([
      "off_duty",
      "on_leave",
      "rest_day",
    ]);

    // Empty State 1: Off Duty
    expect(MAP_EMPTY_STATES.off_duty).toEqual({
      key: "off_duty",
      statusPill: "OFF DUTY",
      title: "You’re Off Duty",
      description: "Live trip tracking becomes available when you start your shift.",
      iconType: "off_duty",
    });

    // Empty State 2: Rest Day
    expect(MAP_EMPTY_STATES.rest_day).toEqual({
      key: "rest_day",
      statusPill: "REST DAY",
      title: "Today is Your Rest Day",
      description: "No operational map or trip tracking is needed today.",
      iconType: "rest_day",
    });

    // Empty State 3: Currently on Leave
    expect(MAP_EMPTY_STATES.on_leave).toEqual({
      key: "on_leave",
      statusPill: "ON LEAVE",
      title: "You’re Currently on Leave",
      description: "Live trip tracking will be available when you return to active duty.",
      iconType: "on_leave",
    });
  });

  describe("resolveMapEmptyState logic", () => {
    const { resolveMapEmptyState } = context;

    it("evaluates On Leave from profile, user status, or duty schedule block reason", () => {
      // Profile status
      expect(resolveMapEmptyState({ profile: { driverStatus: "On Leave" } })).toBe("on_leave");

      // User session status
      expect(resolveMapEmptyState({ user: { driver_status: "On Leave" } })).toBe("on_leave");
      expect(resolveMapEmptyState({ user: { status: "On Leave" } })).toBe("on_leave");

      // Duty today blocked with leave reason
      expect(resolveMapEmptyState({
        duty: {
          loaded: true,
          today: { blocked: true, reason: "Driver is on approved leave." },
        },
      })).toBe("on_leave");
    });

    it("evaluates Rest Day from schedule context or profile status", () => {
      // Profile status
      expect(resolveMapEmptyState({ profile: { driverStatus: "Rest Day" } })).toBe("rest_day");

      // Duty today blocked with rest day reason
      expect(resolveMapEmptyState({
        duty: {
          loaded: true,
          today: { blocked: true, reason: "Driver is on a rest day (Monday)." },
        },
      })).toBe("rest_day");
    });

    it("evaluates Off Duty when driver is not checked in or status is Off Duty", () => {
      // Profile status
      expect(resolveMapEmptyState({ profile: { driverStatus: "Off Duty" } })).toBe("off_duty");

      // User status
      expect(resolveMapEmptyState({ user: { driver_status: "Off Duty" } })).toBe("off_duty");
      expect(resolveMapEmptyState({ user: { status: "Off Duty" } })).toBe("off_duty");

      // Duty loaded and checkedIn is false
      expect(resolveMapEmptyState({
        duty: {
          loaded: true,
          checkedIn: false,
          today: { blocked: false },
        },
      })).toBe("off_duty");
    });

    it("respects hierarchy: Leave outranks Rest Day; Rest Day outranks Off Duty", () => {
      // Leave outranks checkedIn = false
      expect(resolveMapEmptyState({
        duty: {
          loaded: true,
          checkedIn: false,
          today: { blocked: true, reason: "Driver is on approved leave." },
        },
      })).toBe("on_leave");

      // Rest Day outranks checkedIn = false
      expect(resolveMapEmptyState({
        duty: {
          loaded: true,
          checkedIn: false,
          today: { blocked: true, reason: "Driver is on a rest day." },
        },
      })).toBe("rest_day");
    });

    it("supports direct query param override for testing and previews", () => {
      expect(resolveMapEmptyState({ paramStatus: "off_duty" })).toBe("off_duty");
      expect(resolveMapEmptyState({ paramStatus: "OFF DUTY" })).toBe("off_duty");
      expect(resolveMapEmptyState({ paramStatus: "rest_day" })).toBe("rest_day");
      expect(resolveMapEmptyState({ paramStatus: "REST DAY" })).toBe("rest_day");
      expect(resolveMapEmptyState({ paramStatus: "on_leave" })).toBe("on_leave");
      expect(resolveMapEmptyState({ paramStatus: "ON LEAVE" })).toBe("on_leave");
      expect(resolveMapEmptyState({ paramStatus: "leave" })).toBe("on_leave");
    });

    it("returns null when driver is active on duty (eligible for operational live map)", () => {
      expect(resolveMapEmptyState({
        duty: {
          loaded: true,
          checkedIn: true,
          today: { blocked: false },
        },
        profile: { driverStatus: "Available" },
      })).toBeNull();

      expect(resolveMapEmptyState({
        duty: {
          loaded: true,
          checkedIn: true,
          today: { blocked: false },
        },
        profile: { driverStatus: "On Trip" },
      })).toBeNull();
    });

    it("returns null when an active trip is present (never blocks an in-progress dispatch)", () => {
      expect(resolveMapEmptyState({
        duty: { loaded: true, checkedIn: false },
        activeTrip: { trip_id: 101, trip_status: "Dispatched" },
      })).toBeNull();
    });
  });
});
