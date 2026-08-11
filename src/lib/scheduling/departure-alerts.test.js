import { describe, it, expect } from "vitest";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import {
  ALERT_REASON,
  ALERT_TONE,
  DEFAULT_DEPARTURE_ALERTS,
  alertMessage,
  departureAlert,
  departureAlerts,
  normalizeTiers,
} from "@/lib/scheduling/departure-alerts";

const NOW = new Date(2026, 7, 11, 12, 0, 0);

// Departure N minutes after the fixed clock.
const inMin = (n) => new Date(NOW.getTime() + n * 60000).toISOString();

const mk = (over = {}) => ({
  dispatch_id: over.dispatch_id ?? 1,
  status: over.status ?? D.SCHEDULED,
  vehicle_id: over.vehicle_id === undefined ? null : over.vehicle_id,
  driver_id: over.driver_id === undefined ? null : over.driver_id,
  // `in` rather than ??, so a test can pass an explicit null departure.
  scheduled_departure:
    "scheduled_departure" in over ? over.scheduled_departure : inMin(25),
});

const at = (d) => departureAlert(d, { now: NOW });

describe("departureAlert — eligibility", () => {
  it("a fully assigned Scheduled dispatch does not alert", () => {
    expect(at(mk({ vehicle_id: 4, driver_id: 9 }))).toBeNull();
  });

  it("missing vehicle alone alerts", () => {
    expect(at(mk({ vehicle_id: null, driver_id: 9 }))).not.toBeNull();
  });

  it("missing driver alone alerts", () => {
    expect(at(mk({ vehicle_id: 4, driver_id: null }))).not.toBeNull();
  });

  it("Pending Reassignment alerts even when both ids are set", () => {
    const alert = at(mk({ status: D.PENDING_REASSIGNMENT, vehicle_id: 4, driver_id: 9 }));
    expect(alert?.reason).toBe(ALERT_REASON.REASSIGNMENT);
  });

  it("In Progress never alerts — it already left", () => {
    expect(at(mk({ status: D.IN_PROGRESS }))).toBeNull();
  });

  it("Completed and Cancelled never alert", () => {
    expect(at(mk({ status: D.COMPLETED }))).toBeNull();
    expect(at(mk({ status: D.CANCELLED }))).toBeNull();
  });

  it("an undated dispatch never alerts", () => {
    expect(at(mk({ scheduled_departure: null }))).toBeNull();
    expect(at(mk({ scheduled_departure: "not-a-date" }))).toBeNull();
  });

  it("null input is safe", () => {
    expect(at(null)).toBeNull();
  });
});

describe("departureAlert — tier matching", () => {
  it("outside the widest band there is no alert", () => {
    expect(at(mk({ scheduled_departure: inMin(31) }))).toBeNull();
  });

  it("exactly on the widest band alerts at that tier", () => {
    expect(at(mk({ scheduled_departure: inMin(30) }))?.tier).toBe(30);
  });

  it("matches the tightest band containing the dispatch", () => {
    expect(at(mk({ scheduled_departure: inMin(27) }))?.tier).toBe(30);
    expect(at(mk({ scheduled_departure: inMin(20) }))?.tier).toBe(20);
    expect(at(mk({ scheduled_departure: inMin(14) }))?.tier).toBe(20);
    expect(at(mk({ scheduled_departure: inMin(8) }))?.tier).toBe(10);
  });

  it("escalates tone across the bands", () => {
    expect(at(mk({ scheduled_departure: inMin(28) }))?.tone).toBe(ALERT_TONE.notice);
    expect(at(mk({ scheduled_departure: inMin(18) }))?.tone).toBe(ALERT_TONE.warning);
    expect(at(mk({ scheduled_departure: inMin(9) }))?.tone).toBe(ALERT_TONE.critical);
  });

  it("past departure is overdue, tier 0, and still critical", () => {
    const alert = at(mk({ scheduled_departure: inMin(-7) }));
    expect(alert).toMatchObject({ tier: 0, overdue: true, tone: ALERT_TONE.critical });
    expect(alert.minutesLeft).toBe(-7);
  });

  it("departing exactly now is overdue, not a tier match", () => {
    expect(at(mk({ scheduled_departure: inMin(0) }))?.overdue).toBe(true);
  });

  it("honours custom tiers", () => {
    const d = mk({ scheduled_departure: inMin(50) });
    expect(departureAlert(d, { now: NOW, tiers: [60, 45] })?.tier).toBe(60);
    expect(departureAlert(d, { now: NOW, tiers: [90] })?.tier).toBe(90);
  });

  it("a single tier is both first and last, so it reads critical", () => {
    const alert = departureAlert(mk({ scheduled_departure: inMin(5) }), { now: NOW, tiers: [10] });
    expect(alert?.tone).toBe(ALERT_TONE.critical);
  });

  it("falls back to defaults when stored tiers are unusable", () => {
    const d = mk({ scheduled_departure: inMin(25) });
    expect(departureAlert(d, { now: NOW, tiers: [] })?.tier).toBe(30);
    expect(departureAlert(d, { now: NOW, tiers: ["x", -5, 0] })?.tier).toBe(30);
    expect(departureAlert(d, { now: NOW, tiers: null })?.tier).toBe(30);
  });
});

describe("normalizeTiers", () => {
  it("sorts widest first, dedupes, and drops junk", () => {
    expect(normalizeTiers([10, 30, 20])).toEqual([30, 20, 10]);
    expect(normalizeTiers([20, 20, 10])).toEqual([20, 10]);
    expect(normalizeTiers(["15", 5])).toEqual([15, 5]);
    expect(normalizeTiers([0, -1, NaN, "abc"])).toBeNull();
    expect(normalizeTiers("30")).toBeNull();
  });

  it("the shipped defaults are already normalized", () => {
    expect(normalizeTiers(DEFAULT_DEPARTURE_ALERTS.tiers)).toEqual(DEFAULT_DEPARTURE_ALERTS.tiers);
  });
});

describe("departureAlerts — board sweep", () => {
  it("returns only flagged rows, most urgent first", () => {
    const board = [
      mk({ dispatch_id: 1, scheduled_departure: inMin(28) }),
      mk({ dispatch_id: 2, vehicle_id: 4, driver_id: 9, scheduled_departure: inMin(5) }),
      mk({ dispatch_id: 3, scheduled_departure: inMin(-4) }),
      mk({ dispatch_id: 4, scheduled_departure: inMin(12) }),
      mk({ dispatch_id: 5, scheduled_departure: inMin(400) }),
    ];
    const out = departureAlerts(board, { now: NOW });
    expect(out.map((o) => o.dispatch.dispatch_id)).toEqual([3, 4, 1]);
  });

  it("non-array input is safe", () => {
    expect(departureAlerts(null)).toEqual([]);
    expect(departureAlerts(undefined)).toEqual([]);
  });
});

describe("alertMessage", () => {
  it("phrases upcoming, overdue, and reassignment cases", () => {
    expect(alertMessage(at(mk({ scheduled_departure: inMin(18) })))).toBe(
      "Departs in 18 min — still unassigned"
    );
    expect(alertMessage(at(mk({ scheduled_departure: inMin(-6) })))).toBe(
      "6 min overdue — still unassigned"
    );
    expect(alertMessage(at(mk({ scheduled_departure: inMin(0) })))).toBe(
      "Departing now — still unassigned"
    );
    expect(
      alertMessage(at(mk({ status: D.PENDING_REASSIGNMENT, scheduled_departure: inMin(9) })))
    ).toBe("Departs in 9 min — needs reassignment");
  });

  it("null is safe", () => {
    expect(alertMessage(null)).toBe("");
  });
});
