import { describe, expect, it } from "vitest";
import { smartFuelTab, smartQueueTab } from "@/lib/scheduling/smart-default-tab";

describe("smartFuelTab", () => {
  it("holds Pending while loading or on error", () => {
    expect(smartFuelTab({ total: 9, pending: 0 }, { ready: false })).toBe("Pending");
    expect(smartFuelTab(undefined, { ready: false })).toBe("Pending");
  });

  it("stays Pending when review work exists", () => {
    expect(smartFuelTab({ total: 9, pending: 3 }, { ready: true })).toBe("Pending");
  });

  it("lands on All when healthy but non-empty", () => {
    expect(smartFuelTab({ total: 9, pending: 0 }, { ready: true })).toBe("all");
  });

  it("stays Pending when the registry is completely empty", () => {
    expect(smartFuelTab({ total: 0, pending: 0 }, { ready: true })).toBe("Pending");
  });
});

describe("smartQueueTab", () => {
  it("holds Today while loading or on error", () => {
    expect(smartQueueTab({ upcoming: 4 }, { ready: false })).toBe("today");
    expect(smartQueueTab(undefined, { ready: false })).toBe("today");
  });

  it("prefers Today when it has work", () => {
    expect(smartQueueTab({ today: 2, upcoming: 5 }, { ready: true })).toBe("today");
  });

  it("falls through in work order", () => {
    expect(smartQueueTab({ today: 0, upcoming: 5 }, { ready: true })).toBe("upcoming");
    expect(smartQueueTab({ today: 0, upcoming: 0, assigned: 3 }, { ready: true })).toBe("assigned");
    expect(smartQueueTab({ assigned: 0, inProgress: 2 }, { ready: true })).toBe("inProgress");
  });

  it("never greets with an archive tab", () => {
    expect(smartQueueTab({ completed: 40, cancelled: 3 }, { ready: true })).toBe("today");
  });

  it("lands on Today when everything is clear", () => {
    expect(smartQueueTab({ today: 0, upcoming: 0 }, { ready: true })).toBe("today");
  });
});
