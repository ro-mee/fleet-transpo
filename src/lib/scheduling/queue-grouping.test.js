import { describe, it, expect } from "vitest";
import { DERIVED_PRIORITY, RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { bucketRequest, compareByPriority, groupQueue } from "@/lib/scheduling/queue-grouping";

const NOW = new Date(2026, 7, 4, 12, 0, 0);
const todayISO = new Date(2026, 7, 4, 13, 0, 0).toISOString();
const tomorrowISO = new Date(2026, 7, 5, 9, 0, 0).toISOString();

const mk = (over) => ({ request_id: over.request_id ?? 1, fleet_status: over.fleet_status ?? L.PENDING, pickup_datetime: over.pickup_datetime ?? todayISO, derived_priority: over.derived_priority === undefined ? DERIVED_PRIORITY.NORMAL : over.derived_priority, is_vip: false, is_emergency: false });

describe("bucketRequest", () => {
  it("In Progress requests go to inProgress", () => {
    expect(bucketRequest(mk({ fleet_status: L.IN_PROGRESS }), NOW)).toBe("inProgress");
  });

  it("Completed / Cancelled go to their tabs", () => {
    expect(bucketRequest(mk({ fleet_status: L.COMPLETED }), NOW)).toBe("completed");
    expect(bucketRequest(mk({ fleet_status: L.CANCELLED }), NOW)).toBe("cancelled");
  });

  it("a same-day non-terminal request is Today", () => {
    expect(bucketRequest(mk({ fleet_status: L.APPROVED, pickup_datetime: todayISO }), NOW)).toBe("today");
  });

  it("a different-day non-terminal request is Upcoming", () => {
    expect(bucketRequest(mk({ fleet_status: L.APPROVED, pickup_datetime: tomorrowISO }), NOW)).toBe("upcoming");
  });

  it("Overdue same-day stays Today", () => {
    expect(bucketRequest(mk({ derived_priority: DERIVED_PRIORITY.OVERDUE }), NOW)).toBe("today");
  });

  it("Assigned goes to its own lane regardless of pickup date", () => {
    expect(bucketRequest(mk({ fleet_status: L.ASSIGNED, pickup_datetime: todayISO }), NOW)).toBe("assigned");
    expect(bucketRequest(mk({ fleet_status: L.ASSIGNED, pickup_datetime: tomorrowISO }), NOW)).toBe("assigned");
  });

  it("Rejected goes to cancelled bucket fallback", () => {
    expect(bucketRequest(mk({ fleet_status: L.REJECTED }), NOW)).toBe("today");
  });
});

describe("compareByPriority", () => {
  it("sorts Overdue before Critical before High", () => {
    const high = mk({ request_id: 1, derived_priority: DERIVED_PRIORITY.HIGH });
    const critical = mk({ request_id: 2, derived_priority: DERIVED_PRIORITY.CRITICAL });
    const overdue = mk({ request_id: 3, derived_priority: DERIVED_PRIORITY.OVERDUE });
    const sorted = [high, critical, overdue].sort(compareByPriority);
    expect(sorted.map((r) => r.request_id)).toEqual([3, 2, 1]);
  });

  it("breaks ties by soonest pickup", () => {
    const a = mk({ request_id: 1, derived_priority: DERIVED_PRIORITY.NORMAL, pickup_datetime: new Date(2026, 7, 4, 15, 0, 0).toISOString() });
    const b = mk({ request_id: 2, derived_priority: DERIVED_PRIORITY.NORMAL, pickup_datetime: new Date(2026, 7, 4, 14, 0, 0).toISOString() });
    expect([a, b].sort(compareByPriority).map((r) => r.request_id)).toEqual([2, 1]);
  });

  it("puts missing priority last within a tie group", () => {
    const none = mk({ request_id: 1, derived_priority: null });
    const future = mk({ request_id: 2, derived_priority: DERIVED_PRIORITY.FUTURE });
    expect([none, future].sort(compareByPriority).map((r) => r.request_id)).toEqual([2, 1]);
  });
});

describe("groupQueue", () => {
  it("buckets and sorts each tab", () => {
    const reqs = [
      mk({ request_id: 1, fleet_status: L.PENDING, derived_priority: DERIVED_PRIORITY.OVERDUE }),
      mk({ request_id: 2, fleet_status: L.APPROVED, pickup_datetime: tomorrowISO, derived_priority: DERIVED_PRIORITY.HIGH }),
      mk({ request_id: 3, fleet_status: L.IN_PROGRESS }),
      mk({ request_id: 4, fleet_status: L.COMPLETED }),
      mk({ request_id: 5, fleet_status: L.CANCELLED }),
      mk({ request_id: 6, fleet_status: L.APPROVED, derived_priority: DERIVED_PRIORITY.CRITICAL }),
      mk({ request_id: 7, fleet_status: L.ASSIGNED }),
      mk({ request_id: 8, fleet_status: L.ASSIGNED, pickup_datetime: tomorrowISO }),
    ];
    const g = groupQueue(reqs, NOW);
    expect(g.today.map((r) => r.request_id)).toEqual([1, 6]);
    expect(g.upcoming.map((r) => r.request_id)).toEqual([2]);
    expect(g.assigned.map((r) => r.request_id)).toEqual([7, 8]);
    expect(g.inProgress.map((r) => r.request_id)).toEqual([3]);
    expect(g.completed.map((r) => r.request_id)).toEqual([4]);
    expect(g.cancelled.map((r) => r.request_id)).toEqual([5]);
  });
});
