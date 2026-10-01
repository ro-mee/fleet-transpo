import { describe, expect, it } from "vitest";
import {
  QUEUE_FALLBACK_TAB,
  queueTabBadges,
  resolveQueueTabView,
  smartFuelTab,
  smartQueueTab,
} from "@/lib/scheduling/smart-default-tab";

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

describe("resolveQueueTabView", () => {
  it("highlights the FETCHED tab, never the tab it is about to steer to", () => {
    // First load: the query fetches the fallback tab while counts already say
    // the work is in Upcoming. Before this contract the *highlight* moved to
    // Upcoming immediately, so the user read "Upcoming" over Today's rows for
    // the length of a fetch.
    const view = resolveQueueTabView({
      counts: { today: 0, upcoming: 5 },
      countsReady: true,
    });
    expect(view.fetchTab).toBe(QUEUE_FALLBACK_TAB);
    expect(view.activeTab).toBe(QUEUE_FALLBACK_TAB);
    expect(view.activeTab).not.toBe("upcoming");
    // …and the steer is requested once, for the NEXT render.
    expect(view.steerTo).toBe("upcoming");
  });

  it("highlights the steered tab once the override has landed", () => {
    const view = resolveQueueTabView({
      tabOverride: "upcoming",
      counts: { today: 0, upcoming: 5 },
      countsReady: true,
    });
    expect(view.fetchTab).toBe("upcoming");
    expect(view.activeTab).toBe("upcoming");
    // A manual pick is never steered again — polls must not yank it.
    expect(view.steerTo).toBeNull();
  });

  it("never steers away from a manual pick, even when other tabs have work", () => {
    for (const pick of ["today", "assigned", "completed", "cancelled"]) {
      expect(
        resolveQueueTabView({ tabOverride: pick, counts: { inProgress: 9 }, countsReady: true }).steerTo
      ).toBeNull();
    }
  });

  it("does not steer before counts are in, nor when the default is already fetched", () => {
    expect(resolveQueueTabView({ counts: { upcoming: 5 }, countsReady: false }).steerTo).toBeNull();
    expect(
      resolveQueueTabView({ counts: { today: 3, upcoming: 5 }, countsReady: true }).steerTo
    ).toBeNull();
  });
});

describe("queueTabBadges", () => {
  const TABS = ["today", "upcoming", "assigned", "inProgress", "completed", "cancelled"];

  it("reports null — not 0 — for every tab before the first response", () => {
    const badges = queueTabBadges(TABS, {}, false);
    for (const id of TABS) expect(badges[id]).toBeNull();
    // A 0 here would claim the queue is empty rather than not loaded.
    expect(Object.values(badges)).not.toContain(0);
  });

  it("reports real counts once loaded, including a genuine 0", () => {
    const badges = queueTabBadges(TABS, { today: 6, cancelled: 9 }, true);
    expect(badges.today).toBe(6);
    expect(badges.cancelled).toBe(9);
    expect(badges.upcoming).toBe(0);
  });
});
