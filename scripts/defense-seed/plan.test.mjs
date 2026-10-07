import { describe, expect, it } from "vitest";
import { buildDefensePlan } from "./plan.mjs";
import { validateDefensePlan } from "./validation.mjs";

const plan = buildDefensePlan();

describe("defense scenario graph", () => {
  it("pins the corrected dates and leaves defense day for live work", () => {
    expect(plan.window).toEqual({ start: "2026-09-03", end: "2026-10-02", defense: "2026-10-03" });
    expect(new Date("2026-10-03T12:00:00+08:00").getUTCDay()).toBe(6);
    expect(plan.trips.filter((t) => t.status === "Completed" && t.day > plan.window.end)).toEqual([]);
    expect(plan.attendance.filter((a) => a.driver === "D01" && a.day === plan.window.defense)).toEqual([]);
    expect(plan.inspections.filter((i) => i.driver === "D01" && i.day === plan.window.defense)).toEqual([]);
  });

  it("has the full connected booking and resource mix", () => {
    expect(plan.drivers).toHaveLength(10);
    expect(plan.vehicles).toHaveLength(10);
    expect(plan.requests).toHaveLength(45);
    expect(plan.trips.filter((t) => t.status === "Completed")).toHaveLength(30);
    expect(plan.trips.filter((t) => t.status === "Assigned")).toHaveLength(7);
    expect(plan.schedules).toHaveLength(70);
    expect(plan.leaveBalances).toHaveLength(30);
    expect(plan.assignments).toHaveLength(9);
    expect(plan.fuelRecords).toHaveLength(12);
    expect(plan.fuelRequests).toHaveLength(5);
    expect(plan.maintenance).toHaveLength(10);
    expect(plan.incidents).toHaveLength(3);
    expect(plan.expenses).toHaveLength(6);
    expect(new Set(plan.vehicles.map((v) => v.seats))).toEqual(new Set([4, 5, 6, 7]));
    expect(new Set(plan.vehicles.map((v) => v.category))).toEqual(new Set(["VIP Guest Transport", "Guest Transport"]));
    expect(plan.schedules.filter((s) => !s.rest).every((s) => s.start === "06:00" && s.end === "22:00")).toBe(true);
    expect(plan.requests.every((r) => r.pickup.slice(11, 16) >= "06:00" && r.pickup.slice(11, 16) < "22:00")).toBe(true);
    expect(plan.requests.every((r) => /^\+63 9\d{2} \d{3} \d{4}$/.test(r.guestPhone))).toBe(true);
    expect(plan.requests.every((r) => r.guestName && !/demo|test|fixture|seed/i.test(r.guestName))).toBe(true);
  });

  it("keeps D1 ready with five feasible open trips and distributes driver routines", () => {
    const d1 = plan.trips.filter((t) => t.driver === "D01");
    expect(d1.filter((t) => t.status === "Completed")).toHaveLength(6);
    expect(d1.filter((t) => t.status === "Assigned")).toHaveLength(5);
    expect(d1.filter((t) => t.status === "Assigned" && t.day === "2026-10-03")).toHaveLength(2);
    expect(d1.some((t) => t.day === "2026-10-04")).toBe(false);
    expect(plan.leaveRequests).toContainEqual(expect.objectContaining({ driver: "D04", day: "2026-10-03", status: "Pending" }));
    expect(plan.leaveRequests).toContainEqual(expect.objectContaining({ driver: "D07", day: "2026-10-03", status: "Approved" }));
    for (const [index, driver] of plan.drivers.entries()) {
      expect(plan.schedules).toContainEqual(expect.objectContaining({ driver: driver.key, weekday: index % 7, rest: true }));
    }
    expect(new Set(plan.schedules.filter((schedule) => !schedule.rest).map((schedule) => `${schedule.breakStart}-${schedule.breakEnd}`)).size).toBe(4);
    expect(plan.assignments.some((a) => a.driver === "D10")).toBe(false);
  });

  it("passes cross-entity dates, capacity, category, schedule, and overlap checks", () => {
    expect(validateDefensePlan(plan)).toEqual([]);
  });

  it("rejects a deliberately undersized assigned vehicle", () => {
    const bad = structuredClone(plan);
    const target = bad.trips.find((t) => t.status === "Assigned");
    target.passengers = 7;
    expect(validateDefensePlan(bad).join("\n")).toMatch(/capacity/i);
  });
});
