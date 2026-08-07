import { describe, it, expect } from "vitest";
import { DERIVED_PRIORITY, RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { derivePriority, priorityRank } from "@/lib/scheduling/priority";

const NOW = new Date(2026, 7, 4, 12, 0, 0); // fixed clock: Aug 4 2026 12:00

function atMinutes(minutes, base = NOW) {
  return new Date(base.getTime() + minutes * 60000).toISOString();
}

describe("priorityRank", () => {
  it("orders Overdue at the top and Future at the bottom", () => {
    expect(priorityRank(DERIVED_PRIORITY.OVERDUE)).toBeLessThan(priorityRank(DERIVED_PRIORITY.CRITICAL));
    expect(priorityRank(DERIVED_PRIORITY.CRITICAL)).toBeLessThan(priorityRank(DERIVED_PRIORITY.HIGH));
    expect(priorityRank(DERIVED_PRIORITY.HIGH)).toBeLessThan(priorityRank(DERIVED_PRIORITY.MEDIUM));
    expect(priorityRank(DERIVED_PRIORITY.MEDIUM)).toBeLessThan(priorityRank(DERIVED_PRIORITY.NORMAL));
    expect(priorityRank(DERIVED_PRIORITY.NORMAL)).toBeLessThan(priorityRank(DERIVED_PRIORITY.FUTURE));
  });
});

describe("derivePriority — terminal states", () => {
  it("returns null for completed/cancelled/rejected requests", () => {
    for (const st of [L.COMPLETED, L.CANCELLED, L.REJECTED]) {
      expect(derivePriority({ pickupDatetime: atMinutes(-5), fleetStatus: st, now: NOW })).toBeNull();
    }
  });
});

describe("derivePriority — overdue", () => {
  it("marks an unstarted, past pickup as Overdue", () => {
    for (const st of [L.PENDING, L.UNDER_REVIEW, L.APPROVED, L.SCHEDULED, L.ASSIGNED, null]) {
      expect(derivePriority({ pickupDatetime: atMinutes(-10), fleetStatus: st, now: NOW }))
        .toBe(DERIVED_PRIORITY.OVERDUE);
    }
  });

  it("does not mark an In Progress trip as Overdue", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(-30), fleetStatus: L.IN_PROGRESS, now: NOW }))
      .not.toBe(DERIVED_PRIORITY.OVERDUE);
  });
});

describe("derivePriority — time bands (default thresholds 15/30/120)", () => {
  it("Critical inside the critical window", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(10), now: NOW })).toBe(DERIVED_PRIORITY.CRITICAL);
  });

  it("High inside the high window", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(20), now: NOW })).toBe(DERIVED_PRIORITY.HIGH);
  });

  it("Medium inside the medium window", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(60), now: NOW })).toBe(DERIVED_PRIORITY.MEDIUM);
  });

  it("Normal later the same day", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(300), now: NOW })).toBe(DERIVED_PRIORITY.NORMAL);
  });

  it("Future for another day", () => {
    const tomorrow = new Date(2026, 7, 5, 9, 0, 0).toISOString();
    expect(derivePriority({ pickupDatetime: tomorrow, now: NOW })).toBe(DERIVED_PRIORITY.FUTURE);
  });

  it("boundaries split correctly (15/30/120)", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(15), now: NOW })).toBe(DERIVED_PRIORITY.CRITICAL);
    expect(derivePriority({ pickupDatetime: atMinutes(30), now: NOW })).toBe(DERIVED_PRIORITY.HIGH);
    expect(derivePriority({ pickupDatetime: atMinutes(120), now: NOW })).toBe(DERIVED_PRIORITY.MEDIUM);
  });
});

describe("derivePriority — VIP boost", () => {
  it("raises Normal to Medium", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(300), isVip: true, now: NOW }))
      .toBe(DERIVED_PRIORITY.MEDIUM);
  });

  it("raises Medium to High", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(60), isVip: true, now: NOW }))
      .toBe(DERIVED_PRIORITY.HIGH);
  });

  it("caps at High (never Critical)", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(20), isVip: true, now: NOW }))
      .toBe(DERIVED_PRIORITY.HIGH);
  });

  it("never lifts a Future request", () => {
    const tomorrow = new Date(2026, 7, 5, 9, 0, 0).toISOString();
    expect(derivePriority({ pickupDatetime: tomorrow, isVip: true, now: NOW }))
      .toBe(DERIVED_PRIORITY.FUTURE);
  });
});

describe("derivePriority — emergency", () => {
  it("forces Critical within the high window", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(20), isEmergency: true, now: NOW }))
      .toBe(DERIVED_PRIORITY.CRITICAL);
  });

  it("forces Critical within the medium window", () => {
    expect(derivePriority({ pickupDatetime: atMinutes(60), isEmergency: true, now: NOW }))
      .toBe(DERIVED_PRIORITY.CRITICAL);
  });
});

describe("derivePriority — custom thresholds", () => {
  it("honours overridden thresholds", () => {
    const t = { criticalMinutes: 5, highMinutes: 10, mediumMinutes: 40 };
    expect(derivePriority({ pickupDatetime: atMinutes(8), now: NOW, thresholds: t }))
      .toBe(DERIVED_PRIORITY.HIGH);
  });
});
