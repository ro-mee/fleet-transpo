import { describe, it, expect } from "vitest";
import {
  RISK,
  USAGE_WINDOW_DAYS,
  MIN_TRIPS_FOR_CONFIDENCE,
  computeUsageRate,
  daysUntil,
  resolveDueDate,
  riskForDays,
  healthScore,
  predictVehicle,
  predictFleet,
} from "@/lib/ai/predictive-maintenance";

// Fixed clock. Every day-count assertion below is exact, not approximate.
// Built from local components on purpose: `new Date("2026-08-04T00:00:00Z")`
// is 2026-08-03 in any negative-offset zone, which would slide every
// assertion here by a day depending on where the suite runs.
const NOW = new Date(2026, 7, 4);

const HIGH_CONF = { kmPerDay: 100, tripCount: 30, activeDays: 60, confidence: "high" };
const LOW_CONF = { kmPerDay: 0, tripCount: 2, activeDays: 2, confidence: "low" };

describe("constants", () => {
  it("exposes lowercase risk bands", () => {
    expect(RISK).toEqual({
      OVERDUE: "overdue",
      CRITICAL: "critical",
      HIGH: "high",
      MEDIUM: "medium",
      LOW: "low",
    });
  });

  it("uses a 90 day window and a 5 trip confidence floor", () => {
    expect(USAGE_WINDOW_DAYS).toBe(90);
    expect(MIN_TRIPS_FOR_CONFIDENCE).toBe(5);
  });
});

describe("computeUsageRate", () => {
  it("divides distance by the calendar window, not by active days", () => {
    // 600 km over 5 active days = 120 km per *active* day but 6.67 per
    // calendar day. Projecting a future date is a calendar question, so
    // dividing by active_days would overstate the burn rate by the idle ratio
    // and pull every due date forward.
    const usage = computeUsageRate({ km_90d: 600, trip_count: 5, active_days: 5 });
    expect(usage.kmPerDay).toBeCloseTo(600 / 90, 5);
    expect(usage.activeDays).toBe(5);
  });

  it("marks high confidence at the trip floor", () => {
    const usage = computeUsageRate({ km_90d: 900, trip_count: 5, active_days: 20 });
    expect(usage.confidence).toBe("high");
  });

  it("marks low confidence below the trip floor", () => {
    const usage = computeUsageRate({ km_90d: 900, trip_count: 4, active_days: 3 });
    expect(usage.confidence).toBe("low");
    expect(usage.kmPerDay).toBe(0);
  });

  it("marks low confidence when trips exist but cover zero distance", () => {
    const usage = computeUsageRate({ km_90d: 0, trip_count: 12, active_days: 9 });
    expect(usage.confidence).toBe("low");
    expect(usage.kmPerDay).toBe(0);
  });

  it("treats missing usage rows as low confidence rather than throwing", () => {
    // A vehicle with no trips in the window LEFT JOINs to all NULLs.
    const usage = computeUsageRate({ km_90d: null, trip_count: null, active_days: null });
    expect(usage.confidence).toBe("low");
    expect(usage.kmPerDay).toBe(0);
    expect(usage.tripCount).toBe(0);
  });

  it("coerces numeric strings, which is what pg returns for SUM", () => {
    // node-postgres returns DECIMAL/BIGINT aggregates as strings. Unguarded,
    // "900" / 90 works but "900" + 0 does not, and tripCount comparisons
    // against a string silently misbehave.
    const usage = computeUsageRate({ km_90d: "900", trip_count: "10", active_days: "30" });
    expect(usage.kmPerDay).toBeCloseTo(10, 5);
    expect(usage.tripCount).toBe(10);
    expect(usage.confidence).toBe("high");
  });
});

describe("daysUntil", () => {
  it("counts forward days", () => {
    expect(daysUntil("2026-08-24", NOW)).toBe(20);
  });

  it("returns negative days for a past date rather than clamping to zero", () => {
    // The old implementation wrapped this in Math.max(0, ...), so a vehicle
    // three weeks overdue displayed identically to one due today.
    expect(daysUntil("2026-07-17", NOW)).toBe(-18);
  });

  it("returns 0 on the due date itself", () => {
    expect(daysUntil("2026-08-04", NOW)).toBe(0);
  });

  it("returns null for an absent or unparseable date", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("", NOW)).toBeNull();
    expect(daysUntil("not-a-date", NOW)).toBeNull();
  });

  it("ignores the time component of a timestamp", () => {
    // vehicles.next_service_date may arrive as a Date or a timestamp string.
    // Comparing wall-clock instants would make "due today" flip to -1 or 1
    // depending on the hour the request lands.
    expect(daysUntil("2026-08-24T23:30:00Z", NOW)).toBe(20);
  });

  it("reads a pg DATE column as the calendar day it represents", () => {
    // `pg` hands back a DATE as a Date at *local* midnight, so reading UTC
    // components off it lands on the previous day at positive offsets. This
    // case fails if daysUntil ever goes back to getUTCDate()/toISOString().
    expect(daysUntil(new Date(2026, 7, 24), NOW)).toBe(20);
  });
});

describe("resolveDueDate", () => {
  it("lets mileage win when the burn rate arrives before the calendar date", () => {
    // 2,000 km remaining at 100 km/day = 20 days, vs 45 calendar days.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-09-18", next_service_mileage: 52000, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.daysToService).toBe(45);
    expect(out.kmToService).toBe(2000);
    expect(out.projectedDaysToService).toBe(20);
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("mileage");
  });

  it("lets time win when the calendar date arrives first", () => {
    // 12,000 km at 100 km/day = 120 days, vs 10 calendar days.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-08-14", next_service_mileage: 62000, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.effectiveDays).toBe(10);
    expect(out.basis).toBe("time");
  });

  it("falls back to calendar only when confidence is low", () => {
    // kmToService is still reported — it is a real fact worth showing — but it
    // must not produce a projection, because there is no trustworthy rate.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-09-18", next_service_mileage: 50100, mileage: 50000 },
      usage: LOW_CONF,
      now: NOW,
    });
    expect(out.kmToService).toBe(100);
    expect(out.projectedDaysToService).toBeNull();
    expect(out.effectiveDays).toBe(45);
    expect(out.basis).toBe("time");
  });

  it("excludes a missing calendar date from the minimum instead of scoring it as zero", () => {
    const out = resolveDueDate({
      vehicle: { next_service_date: null, next_service_mileage: 52000, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.daysToService).toBeNull();
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("mileage");
  });

  it("excludes a missing service mileage from the minimum", () => {
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-08-24", next_service_mileage: null, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.kmToService).toBeNull();
    expect(out.projectedDaysToService).toBeNull();
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("time");
  });

  it("returns basis null when neither dimension is available", () => {
    // Must NOT collapse to a false `low` — no schedule is set at all, which is
    // a different statement from "healthy".
    const out = resolveDueDate({
      vehicle: { next_service_date: null, next_service_mileage: null, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.effectiveDays).toBeNull();
    expect(out.basis).toBeNull();
  });

  it("does not divide by zero when the vehicle is idle", () => {
    // kmPerDay 0 with high confidence cannot happen via computeUsageRate, but
    // an explicit guard is cheaper than an Infinity leaking into a sort.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-08-24", next_service_mileage: 52000, mileage: 50000 },
      usage: { kmPerDay: 0, tripCount: 30, activeDays: 60, confidence: "high" },
      now: NOW,
    });
    expect(out.projectedDaysToService).toBeNull();
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("time");
  });

  it("withholds the projection when the rate is untrustworthy, even if it is non-zero", () => {
    // The confidence check and the kmPerDay > 0 check are separate guards, and
    // this is the only case that exercises the first one alone. Every other
    // low-confidence fixture also carries kmPerDay 0, because computeUsageRate
    // zeroes the rate itself — so without this test, deleting
    // `usage.confidence === "high"` from resolveDueDate leaves the suite green.
    // That matters if computeUsageRate is ever refactored to return the true
    // rate and let callers decide: low-confidence vehicles would silently
    // regain projections with nothing failing.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-08-24", next_service_mileage: 52000, mileage: 50000 },
      usage: { kmPerDay: 100, tripCount: 2, activeDays: 2, confidence: "low" },
      now: NOW,
    });
    expect(out.kmToService).toBe(2000);
    expect(out.projectedDaysToService).toBeNull();
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("time");
  });

  it("reports an already-exceeded service mileage as overdue, not as a future projection", () => {
    // mileage past next_service_mileage means kmToService is negative; the
    // projection must go negative too rather than flipping sign into the future.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-09-18", next_service_mileage: 49500, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.kmToService).toBe(-500);
    expect(out.projectedDaysToService).toBe(-5);
    expect(out.effectiveDays).toBe(-5);
    expect(out.basis).toBe("mileage");
  });

  it("coerces string mileage values from pg", () => {
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-09-18", next_service_mileage: "52000", mileage: "50000" },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.kmToService).toBe(2000);
    expect(out.basis).toBe("mileage");
  });
});

describe("riskForDays", () => {
  it("bands each boundary exactly", () => {
    expect(riskForDays(-1)).toBe(RISK.OVERDUE);
    expect(riskForDays(-18)).toBe(RISK.OVERDUE);
    expect(riskForDays(0)).toBe(RISK.CRITICAL);
    expect(riskForDays(7)).toBe(RISK.CRITICAL);
    expect(riskForDays(8)).toBe(RISK.HIGH);
    expect(riskForDays(30)).toBe(RISK.HIGH);
    expect(riskForDays(31)).toBe(RISK.MEDIUM);
    expect(riskForDays(90)).toBe(RISK.MEDIUM);
    expect(riskForDays(91)).toBe(RISK.LOW);
    expect(riskForDays(9999)).toBe(RISK.LOW);
  });

  it("treats no schedule as low rather than throwing", () => {
    // basis null vehicles are excluded from the urgency sort separately; the
    // band still has to be a legal value so the badge renders.
    expect(riskForDays(null)).toBe(RISK.LOW);
  });
});

describe("healthScore", () => {
  it("scores an overdue vehicle far below a healthy one", () => {
    const overdue = healthScore({ effectiveDays: -18, correctiveCount: 0, totalCount: 0 });
    const healthy = healthScore({ effectiveDays: 200, correctiveCount: 0, totalCount: 0 });
    expect(overdue).toBeLessThan(healthy);
    expect(overdue).toBeLessThan(30);
    expect(healthy).toBeGreaterThan(90);
  });

  it("stays within 0 and 100 at the extremes", () => {
    const worst = healthScore({ effectiveDays: -900, correctiveCount: 40, totalCount: 40 });
    const best = healthScore({ effectiveDays: 9999, correctiveCount: 0, totalCount: 20 });
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(best).toBeLessThanOrEqual(100);
  });

  it("penalises a corrective-heavy repair history", () => {
    // Three unplanned repairs is genuinely worse than none at the same urgency.
    // The old engine returned a hardcoded 95 for both.
    const clean = healthScore({ effectiveDays: 120, correctiveCount: 0, totalCount: 6 });
    const dirty = healthScore({ effectiveDays: 120, correctiveCount: 3, totalCount: 6 });
    expect(dirty).toBeLessThan(clean);
  });

  it("does not penalise a vehicle with no maintenance history", () => {
    // totalCount 0 must not divide by zero or read as 100% corrective.
    const noHistory = healthScore({ effectiveDays: 120, correctiveCount: 0, totalCount: 0 });
    const cleanHistory = healthScore({ effectiveDays: 120, correctiveCount: 0, totalCount: 6 });
    expect(noHistory).toBe(cleanHistory);
  });

  it("returns an integer", () => {
    expect(Number.isInteger(healthScore({ effectiveDays: 17, correctiveCount: 1, totalCount: 3 }))).toBe(true);
  });

  it("scores a vehicle with no schedule as unknown-but-not-perfect", () => {
    // Pinned to the exact mid-point, not a 0-100 range: the whole point of this
    // case is that an unknown schedule must NOT score as healthy, and a range
    // assertion passes just as happily if the function returns 100. The
    // function's own docstring says claiming 95 here would be a lie about data
    // that does not exist; 50 is the value that encodes "unknown".
    const none = healthScore({ effectiveDays: null, correctiveCount: 0, totalCount: 0 });
    expect(none).toBe(50);
  });
});

// Shape matches one row of the endpoint's CTE query.
function row(overrides = {}) {
  return {
    vehicle_id: 1,
    plate_number: "ABC-1234",
    vehicle_name: "HIACE COMMUTER",
    mileage: 50000,
    next_service_date: "2026-09-18",
    next_service_mileage: 52000,
    last_service_date: "2026-05-01",
    service_interval_km: 5000,
    service_interval_days: 180,
    vehicle_status: "Available",
    km_90d: 9000,
    trip_count: 30,
    active_days: 60,
    corrective_count: 0,
    total_count: 4,
    ...overrides,
  };
}

describe("predictVehicle", () => {
  it("returns the documented response shape", () => {
    const p = predictVehicle(row(), NOW);
    expect(Object.keys(p).sort()).toEqual(
      [
        "basis",
        "confidence",
        "daysToService",
        "effectiveDays",
        "kmPerDay",
        "kmToService",
        "last_service_date",
        "mileage",
        "next_service_date",
        "next_service_mileage",
        "plate_number",
        "projectedDaysToService",
        "recommendation",
        "risk",
        "score",
        "vehicle_id",
        "vehicle_name",
      ].sort()
    );
  });

  it("escalates on mileage before the calendar date arrives", () => {
    // 9,000 km / 90 days = 100 km/day. 2,000 km remaining = 20 days,
    // against 45 calendar days.
    const p = predictVehicle(row(), NOW);
    expect(p.kmPerDay).toBeCloseTo(100, 5);
    expect(p.effectiveDays).toBe(20);
    expect(p.basis).toBe("mileage");
    expect(p.risk).toBe(RISK.HIGH);
    expect(p.confidence).toBe("high");
  });

  it("reports an overdue vehicle with negative days", () => {
    const p = predictVehicle(
      row({ next_service_date: "2026-07-17", next_service_mileage: null }),
      NOW
    );
    expect(p.daysToService).toBe(-18);
    expect(p.effectiveDays).toBe(-18);
    expect(p.risk).toBe(RISK.OVERDUE);
  });

  it("falls back to calendar only and says so when trip data is thin", () => {
    const p = predictVehicle(row({ trip_count: 2, km_90d: 120 }), NOW);
    expect(p.confidence).toBe("low");
    expect(p.projectedDaysToService).toBeNull();
    expect(p.basis).toBe("time");
    expect(p.recommendation).toMatch(/not enough trip data/i);
  });

  it("states that no schedule is set when both dimensions are absent", () => {
    const p = predictVehicle(
      row({ next_service_date: null, next_service_mileage: null }),
      NOW
    );
    expect(p.basis).toBeNull();
    expect(p.effectiveDays).toBeNull();
    expect(p.recommendation).toMatch(/no service schedule/i);
  });

  it("names the mileage basis in the recommendation when mileage wins", () => {
    // Pins the mileage-driven sentence shape specifically. The looser
    // /km\/day|mileage/i this replaces also matched the no-schedule string
    // ("add a next service date or mileage..."), so returning the no-schedule
    // prose unconditionally would have kept the old assertion green.
    const p = predictVehicle(row(), NOW);
    expect(p.recommendation).toMatch(/km to service at ~\d+ km\/day/);
    expect(p.recommendation).not.toMatch(/no service schedule/i);
  });
});

describe("predictFleet", () => {
  it("sorts by effective days, not by raw calendar days", () => {
    // The mileage-critical van has a LATER calendar date but is due sooner once
    // its burn rate is applied. Sorting on daysToService would bury it.
    const rows = [
      row({
        vehicle_id: 1,
        plate_number: "CAL-0001",
        next_service_date: "2026-08-29", // 25 calendar days
        next_service_mileage: null,
      }),
      row({
        vehicle_id: 2,
        plate_number: "MIL-0002",
        next_service_date: "2026-12-01", // 119 calendar days
        next_service_mileage: 50300, // 300 km at 100 km/day = 3 days
      }),
    ];
    const { predictions } = predictFleet(rows, NOW);
    expect(predictions.map((p) => p.plate_number)).toEqual(["MIL-0002", "CAL-0001"]);
    expect(predictions[0].effectiveDays).toBe(3);
  });

  it("sorts unscheduled vehicles last instead of ranking them as healthy", () => {
    const rows = [
      row({ vehicle_id: 1, plate_number: "NONE-01", next_service_date: null, next_service_mileage: null }),
      row({ vehicle_id: 2, plate_number: "DUE-02", next_service_date: "2026-08-09", next_service_mileage: null }),
    ];
    const { predictions } = predictFleet(rows, NOW);
    expect(predictions.map((p) => p.plate_number)).toEqual(["DUE-02", "NONE-01"]);
  });

  it("precomputes band counts so the stat cards read one number each", () => {
    const rows = [
      row({ vehicle_id: 1, next_service_date: "2026-07-17", next_service_mileage: null }), // overdue
      row({ vehicle_id: 2, next_service_date: "2026-08-06", next_service_mileage: null }), // critical (2)
      row({ vehicle_id: 3, next_service_date: "2026-08-24", next_service_mileage: null }), // high (20)
      row({ vehicle_id: 4, next_service_date: "2026-09-18", next_service_mileage: null }), // medium (45)
      row({ vehicle_id: 5, next_service_date: "2027-06-01", next_service_mileage: null }), // low
      row({ vehicle_id: 6, next_service_date: null, next_service_mileage: null }),         // unscheduled
    ];
    const { summary } = predictFleet(rows, NOW);
    expect(summary).toEqual({
      overdue: 1,
      critical: 1,
      high: 1,
      medium: 1,
      low: 2, // the low vehicle plus the unscheduled one, which bands as low
      total: 6,
      unscheduled: 1,
    });
  });

  it("returns empty results for an empty fleet without throwing", () => {
    const { predictions, summary } = predictFleet([], NOW);
    expect(predictions).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.overdue).toBe(0);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ vehicle_id: 1 }), row({ vehicle_id: 2 })];
    const before = rows.map((r) => r.vehicle_id);
    predictFleet(rows, NOW);
    expect(rows.map((r) => r.vehicle_id)).toEqual(before);
  });
});
