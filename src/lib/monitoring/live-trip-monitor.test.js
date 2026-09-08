// Tests for the pure live-trip monitor engine
// (src/lib/monitoring/live-trip-monitor.js).
//
// The honesty contract being pinned:
// - stale/dead GPS → ETA unknown, never an old value presented as live;
// - no truthful schedule baseline → delay null, never invented;
// - UNKNOWN never becomes NORMAL ("can't tell" ≠ "all good");
// - the next trip is the next ASSIGNED dispatch only (pending queue ignored
//   by construction — the engine never sees queue data);
// - thresholds 5/10/15 min and a 10-min turnaround safety floor;
// - worst-of-signals with ACTION for a projected next-pickup miss.
import { describe, it, expect } from "vitest";
import {
  evaluateLiveTripMonitor,
  fleetSortRank,
  WATCH_DELAY_MIN,
  ATTENTION_DELAY_MIN,
  ACTION_DELAY_MIN,
  TURNAROUND_SAFETY_MIN,
} from "@/lib/monitoring/live-trip-monitor";

const NOW = new Date("2026-09-08T10:00:00+08:00");
const PICKUP_AT = "2026-09-08T10:30:00+08:00";
const ARRIVAL_AT = "2026-09-08T11:00:00+08:00";

// A healthy trip: fresh GPS, 20 min from pickup, pickup scheduled 30 min out.
function healthy(overrides = {}) {
  return evaluateLiveTripMonitor({
    now: NOW,
    tripPhase: "to_pickup",
    gpsHealth: "fresh",
    gpsAccuracyM: 15,
    scheduledPickupAt: PICKUP_AT,
    liveTargetMinutes: 20,
    trafficDelayMinutes: 0,
    ...overrides,
  });
}

describe("evaluateLiveTripMonitor — baseline", () => {
  it("a healthy on-time trip is NORMAL with a live ETA", () => {
    const result = healthy();
    expect(result.risk).toBe("NORMAL");
    expect(result.activeTarget).toBe("pickup");
    expect(result.liveEta).toBe(new Date(NOW.getTime() + 20 * 60000).toISOString());
    expect(result.targetDelayMin).toBe(-10); // 10 min ahead of the baseline
    expect(result.reasons).toHaveLength(0);
  });

  it("thresholds are the locked constants", () => {
    expect(WATCH_DELAY_MIN).toBe(5);
    expect(ATTENTION_DELAY_MIN).toBe(10);
    expect(ACTION_DELAY_MIN).toBe(15);
    expect(TURNAROUND_SAFETY_MIN).toBe(10);
  });

  it("phase change moves the active target and the baseline", () => {
    const result = healthy({
      tripPhase: "to_destination",
      scheduledArrivalAt: ARRIVAL_AT,
      scheduledPickupAt: PICKUP_AT,
      liveTargetMinutes: 55, // ETA 10:55 → 5 min before the 11:00 baseline
    });
    expect(result.activeTarget).toBe("destination");
    expect(result.targetDelayMin).toBe(-5);
    expect(result.risk).toBe("NORMAL");
  });
});

describe("delay thresholds", () => {
  it.each([
    [30, "WATCH"],   // ETA 10:30 = exactly on time +0 → NORMAL... overridden below
    [35, "WATCH"],   // 5 min late
    [40, "ATTENTION"], // 10 min late
    [45, "ACTION"],  // 15 min late
  ])("liveTargetMinutes=%d against a 10:30 pickup", (minutes, expected) => {
    const result = healthy({ liveTargetMinutes: minutes });
    if (minutes === 30) {
      // Exactly on time is a KNOWN healthy delay (0 min) → NORMAL.
      expect(result.risk).toBe("NORMAL");
      expect(result.targetDelayMin).toBe(0);
    } else {
      expect(result.risk).toBe(expected);
    }
  });

  it("traffic delay is surfaced as a reason when it crosses WATCH", () => {
    const result = healthy({ liveTargetMinutes: 26, trafficDelayMinutes: 7 });
    expect(result.trafficDelayMin).toBe(7);
    expect(result.reasons.some((r) => r.includes("Traffic"))).toBe(true);
  });
});

describe("GPS honesty", () => {
  it("stale (offline) GPS → ETA unknown and risk UNKNOWN, never a fake ETA", () => {
    const result = healthy({ gpsHealth: "stale", liveTargetMinutes: 20 });
    expect(result.liveEta).toBeNull();
    expect(result.targetDelayMin).toBeNull();
    expect(result.risk).toBe("UNKNOWN");
    expect(result.reasons.some((r) => r.includes("offline"))).toBe(true);
  });

  it("no-signal GPS behaves like stale", () => {
    const result = healthy({ gpsHealth: "no-signal", liveTargetMinutes: 20 });
    expect(result.liveEta).toBeNull();
    expect(result.risk).toBe("UNKNOWN");
  });

  it("delayed GPS still projects an ETA but flags the staleness", () => {
    const result = healthy({ gpsHealth: "delayed" });
    expect(result.liveEta).not.toBeNull();
    expect(result.reasons.some((r) => r.includes("delayed"))).toBe(true);
  });

  it("missing liveTargetMinutes (routing unknown) → UNKNOWN, not NORMAL", () => {
    const result = healthy({ liveTargetMinutes: null });
    expect(result.liveEta).toBeNull();
    expect(result.risk).toBe("UNKNOWN");
  });
});

describe("baseline honesty", () => {
  it("no scheduled pickup baseline → delay null, never invented", () => {
    const result = healthy({ scheduledPickupAt: null });
    expect(result.targetDelayMin).toBeNull();
    expect(result.risk).toBe("UNKNOWN");
    expect(result.reasons.some((r) => r.includes("No scheduled pickup baseline"))).toBe(true);
  });

  it("UNKNOWN never becomes NORMAL even when other signals are known-good", () => {
    // Comfortable next-trip slack but delay unknown — still not "all good".
    const result = healthy({
      liveTargetMinutes: null,
      nextAssignedPickupAt: "2026-09-08T13:00:00+08:00",
      repositionMinutes: 15,
    });
    expect(result.risk).toBe("UNKNOWN");
  });
});

describe("next ASSIGNED trip impact", () => {
  it("no next trip → nextTrip slack null, no impact claim", () => {
    const result = healthy();
    expect(result.nextTrip.slackMin).toBeNull();
    expect(result.nextTrip.impact).toBeNull();
    expect(result.risk).toBe("NORMAL");
  });

  it("comfortable slack is surfaced with a specific sentence", () => {
    const result = healthy({
      nextAssignedPickupAt: "2026-09-08T13:00:00+08:00",
      repositionMinutes: 15,
    });
    // ETA 10:20 + passenger 0 + reposition 15 → 10:35 vs 13:00 ≈ 145 min slack.
    expect(result.nextTrip.slackMin).toBe(145);
    expect(result.nextTrip.impact).toContain("Comfortable");
    expect(result.nextTrip.atRisk).toBe(false);
    expect(result.risk).toBe("NORMAL");
  });

  it("the passenger leg counts when still before pickup", () => {
    const result = healthy({
      plannedPassengerMinutes: 30,
      nextAssignedPickupAt: "2026-09-08T12:00:00+08:00",
      repositionMinutes: 15,
    });
    // ETA pickup 10:20 + passenger 30 + reposition 15 → 11:05 vs 12:00 = 55 min.
    expect(result.nextTrip.slackMin).toBe(55);
  });

  it("slack below the safety floor → WATCH with a specific reason", () => {
    const result = healthy({
      nextAssignedPickupAt: "2026-09-08T10:35:00+08:00",
      repositionMinutes: 5,
    });
    // ETA 10:20 + 0 + 5 → 10:25 vs 10:35 = 10 min → at the floor, not at risk
    // per "< TURNAROUND_SAFETY_MIN". Make it tighter:
    expect(result.nextTrip.slackMin).toBe(10);
    expect(result.nextTrip.atRisk).toBe(false);

    const tight = healthy({
      nextAssignedPickupAt: "2026-09-08T10:32:00+08:00",
      repositionMinutes: 5,
    });
    expect(tight.nextTrip.slackMin).toBe(7);
    expect(tight.nextTrip.atRisk).toBe(true);
    expect(tight.risk).toBe("WATCH");
    expect(tight.nextTrip.impact).toContain("turnaround slack");
  });

  it("projected miss → ACTION directly, even from an on-time trip", () => {
    const result = healthy({
      nextAssignedPickupAt: "2026-09-08T10:20:00+08:00",
      repositionMinutes: 10,
    });
    // ETA 10:20 + 10 reposition → 10:30 vs 10:20 = -10 min.
    expect(result.nextTrip.slackMin).toBe(-10);
    expect(result.risk).toBe("ACTION");
    expect(result.nextTrip.impact).toContain("about 10 minutes late");
    expect(result.suggestedActions).toContain("Review Reassignment");
  });

  it("unknown reposition minutes → honest unknown impact", () => {
    const result = healthy({
      nextAssignedPickupAt: "2026-09-08T10:35:00+08:00",
      repositionMinutes: null,
    });
    expect(result.nextTrip.slackMin).toBeNull();
    expect(result.reasons.some((r) => r.includes("Reposition"))).toBe(true);
  });
});

describe("off-route and incidents", () => {
  it("confirmed off-route → at least ATTENTION", () => {
    const result = healthy({ offRouteState: "off_route", offRouteDistanceM: 400 });
    expect(result.risk).toBe("ATTENTION");
    expect(result.offRoute).toEqual({ state: "off_route", distanceM: 400 });
    expect(result.reasons.some((r) => r.includes("400 m"))).toBe(true);
  });

  it("on-route state alone does not change risk", () => {
    const result = healthy({ offRouteState: "on_route" });
    expect(result.risk).toBe("NORMAL");
  });

  it("open Critical/Major incident → at least ATTENTION and surfaces it", () => {
    const result = healthy({
      openIncident: { severity: "Major", incident_type: "Vehicle issue", incident_id: 9 },
    });
    expect(result.risk).toBe("ATTENTION");
    expect(result.reasons.some((r) => r.includes("Vehicle issue"))).toBe(true);
    expect(result.suggestedActions).toContain("View Incident");
  });

  it("a Minor incident is surfaced as a reason but does not raise risk", () => {
    const result = healthy({
      openIncident: { severity: "Minor", incident_type: "Guest complaint", incident_id: 9 },
    });
    expect(result.risk).toBe("NORMAL");
  });
});

describe("worst-of-signals", () => {
  it("ACTION delay dominates ATTENTION off-route", () => {
    const result = healthy({
      liveTargetMinutes: 46, // 16 min late
      offRouteState: "off_route",
    });
    expect(result.risk).toBe("ACTION");
  });

  it("UNKNOWN with dead GPS and no other signals stays UNKNOWN despite an off-route unknown", () => {
    const result = healthy({ gpsHealth: "stale", liveTargetMinutes: null, offRouteState: "unknown" });
    expect(result.risk).toBe("UNKNOWN");
  });
});

describe("fleetSortRank", () => {
  it("orders ACTION > ATTENTION > UNKNOWN > WATCH > NORMAL", () => {
    const order = ["ACTION", "ATTENTION", "UNKNOWN", "WATCH", "NORMAL"]
      .map(fleetSortRank);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(fleetSortRank("garbage")).toBe(2);
  });
});
