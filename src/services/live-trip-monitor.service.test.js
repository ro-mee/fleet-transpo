// Tests for the live trip monitor I/O service
// (src/services/live-trip-monitor.service.js).
//
// The contracts being pinned:
// - FULL mode (selected trip) pays for routing; CHEAP mode (fleet summary,
//   review correction #4) never calls TomTom — cached signals only;
// - the corridor polyline is PINNED: a deviation re-baselines nothing, and it
//   is fetched at most once per trip per refresh window at ingest;
// - off-route hysteresis is anchored in the durable trip_monitor_alerts row,
//   so a cold instance (or a second request) still knows about ping #1;
// - alert writes happen only on appear / severity-change / resolve, and
//   notifications fire on THRESHOLD ENTRY (review correction #3): entering
//   ACTION notifies dispatcher + fleet_manager with a push; entering
//   ATTENTION notifies the dispatcher; UNKNOWN counts below ATTENTION, so
//   no-previous-row → ACTION still notifies;
// - cheap summaries are elevated by worst active alert severity so a
//   confirmed problem never reads NORMAL just because the cheap pass cannot
//   recompute it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRIP_STATUS } from "@/lib/constants";
import { clearRouteCache } from "@/lib/routing/route-cache";
import { clearTripGeofenceCache } from "@/services/trip-geofence.service";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, query: vi.fn(async () => ({ rows: [] })) };
});
vi.mock("@/lib/tomtom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchTomTomRoute: vi.fn(async () => null) };
});
vi.mock("@/services/push.service", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sendPush: vi.fn(async () => []) };
});

import { query as libQuery } from "@/lib/db";
import { fetchTomTomRoute } from "@/lib/tomtom";
import { sendPush } from "@/services/push.service";
import {
  clearMonitorSnapshots,
  evaluateLiveTripMonitor,
  evaluatePingMonitor,
  resolveMonitorAlerts,
  summarizeFleet,
  sweepStaleMonitorAlerts,
  syncMonitorAlerts,
} from "@/services/live-trip-monitor.service";

const NOW = new Date("2026-09-08T10:00:00+08:00");

// Due-north corridor used as the mocked TomTom geometry (lng 121.0).
const CORRIDOR = [[14.5, 121.0], [14.51, 121.0], [14.52, 121.0]];
const ON_ROUTE = [14.505, 121.0];
const FAR_OFF = [14.51, 121.0031]; // ~334 m east of the corridor
const NEAR = [14.51, 121.0004]; // ~45 m

function ping([lat, lng], ageMs = 0, accuracy = 20) {
  return {
    tracking_id: 1,
    latitude: String(lat),
    longitude: String(lng),
    accuracy,
    recorded_at: new Date(NOW.getTime() - ageMs).toISOString(),
  };
}

function tripRow(overrides = {}) {
  return {
    trip_id: 101,
    trip_status: TRIP_STATUS.TRIP_STARTED,
    vehicle_id: 5,
    driver_id: 7,
    dispatch_id: 55,
    route_id: 1,
    origin: "CoCo Star Hotel",
    destination: "Makati",
    start_time: NOW.toISOString(),
    plate_number: "ABC 1234",
    vehicle_name: "Hiace Commuter",
    driver_first_name: "Ana",
    driver_last_name: "Reyes",
    dispatch_number: "DSP-001",
    scheduled_departure: NOW.toISOString(),
    scheduled_arrival: "2026-09-08T11:00:00+08:00",
    request_id: 900,
    pickup_datetime: "2026-09-08T10:30:00+08:00",
    pickup_location: "Makati",
    dropoff_location: "CoCo Star Hotel",
    gps_pings: [ping(ON_ROUTE)],
    ...overrides,
  };
}

const ROUTE_LOCATIONS_ROW = {
  route_id: 1,
  o_id: 11, o_name: "CoCo Star Hotel", o_lat: "14.5", o_lng: "121.0", o_radius: null,
  d_id: 12, d_name: "Makati", d_lat: "14.52", d_lng: "121.0", d_radius: null,
};

/** Fake db with substring-dispatched handlers; default { rows: [] }. */
function makeDb(handlers = []) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params = []) {
      const s = String(sql);
      calls.push({ sql: s, params });
      for (const [test, result] of handlers) {
        if (s.includes(test)) {
          return typeof result === "function" ? result(s, params) : { rows: result };
        }
      }
      return { rows: [] };
    },
  };
  return db;
}

/** Stateful in-memory trip_monitor_alerts keyed by signal_key. */
function alertTable(tripId = 101) {
  const state = new Map();
  let nextId = 1;
  const activeRows = () => [...state.entries()]
    .filter(([, row]) => row.active)
    .map(([key, row]) => ({ trip_id: tripId, signal_key: key, ...row }));
  return {
    state,
    handlers: [
      ["WHERE active AND trip_id = ANY($1)", () => ({ rows: activeRows() })],
      ["SELECT alert_id, severity, active", (s, p) => ({
        // Return a COPY: the service reads existing.severity after its own
        // UPDATE resolves, and a live reference would alias the mutation
        // (real pg rows are snapshots, not references into the table).
        rows: state.has(p[1]) ? [{ ...state.get(p[1]) }] : [],
      })],
      ["INSERT INTO trip_monitor_alerts", (s, p) => {
        state.set(p[1], { alert_id: nextId++, trip_id: p[0], severity: p[2], active: true });
        return { rows: [] };
      }],
      ["UPDATE trip_monitor_alerts", (s, p) => {
        const affected = s.includes("WHERE alert_id = $1")
          ? [...state.values()].filter((r) => r.alert_id === Number(p[0]))
          : [...state.values()].filter((r) => r.trip_id === Number(p[0]));
        if (s.includes("active = false")) affected.forEach((r) => { r.active = false; });
        else if (s.includes("active = true")) affected.forEach((r) => {
          r.active = true; r.severity = p[1];
        });
        else if (s.includes("SET severity = $2")) affected.forEach((r) => { r.severity = p[1]; });
        return { rows: s.includes("RETURNING") ? affected.map(() => ({})) : [] };
      }],
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMonitorSnapshots();
  clearRouteCache();
  clearTripGeofenceCache();
  libQuery.mockImplementation(async () => ({ rows: [] }));
  fetchTomTomRoute.mockImplementation(async () => null);
});

// ─── Severity-jump notifications (review correction #3) ─────────────────────

function delayEvaluation(delayMin, overrides = {}) {
  return {
    risk: "NORMAL",
    activeTarget: "pickup",
    liveEta: delayMin != null ? "2026-09-08T10:20:00+08:00" : null,
    targetDelayMin: delayMin,
    trafficDelayMin: null,
    offRoute: { state: "on_route", distanceM: 10 },
    nextTrip: { slackMin: null, impact: null, nextPickupAt: null, atRisk: null },
    gps: { health: "fresh", accuracyM: 15 },
    reasons: [],
    suggestedActions: [],
    ...overrides,
  };
}

describe("syncMonitorAlerts — threshold-entry notifications", () => {
  function run(existing, evaluation) {
    const table = alertTable();
    if (existing) {
      table.state.set("pickup_delay", {
        alert_id: 1, trip_id: 101, severity: existing, active: true,
      });
    }
    const db = makeDb(table.handlers);
    return syncMonitorAlerts(db, {
      tripId: 101,
      evaluation,
      trip: tripRow(),
      now: NOW,
    }).then((result) => ({ result, db, table }));
  }

  it("appearing at WATCH records the alert but notifies nobody", async () => {
    const { result, db } = await run(null, delayEvaluation(7));
    expect(result.changes).toEqual([
      expect.objectContaining({ key: "pickup_delay", from: null, to: "WATCH" }),
    ]);
    expect(result.notifications).toEqual([]);
    expect(db.calls.some((c) => c.sql.includes("INSERT INTO notifications"))).toBe(false);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("appearing at ATTENTION notifies the dispatcher (Warning, no push)", async () => {
    libQuery.mockImplementation(async () => ({ rows: [{ employee_id: 3 }] }));
    const { result, db } = await run(null, delayEvaluation(12));
    expect(result.changes[0]).toMatchObject({ key: "pickup_delay", to: "ATTENTION" });
    expect(result.notifications).toEqual([
      { key: "pickup_delay", to: "ATTENTION", type: "Warning", recipients: 1 },
    ]);
    const inserts = db.calls.filter((c) => c.sql.includes("INSERT INTO notifications"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[3]).toBe("Warning");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("WATCH → ACTION notifies dispatcher AND fleet_manager with a push", async () => {
    libQuery.mockImplementation(async () => ({ rows: [{ employee_id: 3 }, { employee_id: 2 }] }));
    const { result, db } = await run("WATCH", delayEvaluation(16));
    expect(result.changes[0]).toMatchObject({ key: "pickup_delay", from: "WATCH", to: "ACTION" });
    const inserts = db.calls.filter((c) => c.sql.includes("INSERT INTO notifications"));
    expect(inserts).toHaveLength(2);
    expect(inserts.every((c) => c.params[3] === "Alert")).toBe(true);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0].employeeIds).toEqual([3, 2]);
  });

  it("no previous row → ACTION notifies (UNKNOWN counts below ATTENTION)", async () => {
    libQuery.mockImplementation(async () => ({ rows: [{ employee_id: 3 }] }));
    const { result } = await run(null, delayEvaluation(null, {
      nextTrip: { slackMin: -10, impact: "miss", nextPickupAt: "x", atRisk: true },
    }));
    // The delay is unknown (no signal either way); the next-trip miss appears
    // straight at ACTION — the jump must still notify.
    expect(result.changes).toEqual([
      expect.objectContaining({ key: "next_trip_risk", from: null, to: "ACTION" }),
    ]);
    expect(result.notifications[0]).toMatchObject({ type: "Alert" });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("ATTENTION → ACTION fires the stronger entry", async () => {
    libQuery.mockImplementation(async () => ({ rows: [{ employee_id: 3 }] }));
    const { result } = await run("ATTENTION", delayEvaluation(16));
    expect(result.notifications).toEqual([
      { key: "pickup_delay", to: "ACTION", type: "Alert", recipients: 1 },
    ]);
  });

  it("same-severity repeats never re-notify", async () => {
    libQuery.mockImplementation(async () => ({ rows: [{ employee_id: 3 }] }));
    const { result } = await run("ATTENTION", delayEvaluation(12));
    expect(result.changes).toEqual([]);
    expect(result.notifications).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("a known-good delay resolves the alert without notifying", async () => {
    const { result, table } = await run("WATCH", delayEvaluation(2));
    expect(result.changes).toEqual([
      expect.objectContaining({ key: "pickup_delay", resolved: true }),
    ]);
    expect(table.state.get("pickup_delay").active).toBe(false);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("an UNKNOWN delay never resolves an active alert (hysteresis)", async () => {
    const { result, table } = await run("WATCH", delayEvaluation(null));
    expect(result.changes).toEqual([]);
    expect(table.state.get("pickup_delay").active).toBe(true);
  });
});

// ─── FULL evaluation (selected trip) ────────────────────────────────────────

function fullDb({ trips, table = alertTable(), nextDispatch = [] } = {}) {
  const handlers = [
    ["FROM trips t", () => ({ rows: trips })],
    ["FROM routes r", () => ({ rows: [ROUTE_LOCATIONS_ROW] })],
    ["FROM dispatchschedules ds", () => ({ rows: nextDispatch })],
    ...table.handlers,
  ];
  const db = makeDb(handlers);
  return { db, table };
}

describe("evaluateLiveTripMonitor — full mode", () => {
  it("returns null for a missing trip and live:false for a non-live status", async () => {
    const missing = fullDb({ trips: [] });
    expect(await evaluateLiveTripMonitor(missing.db, { tripId: 101, now: NOW })).toBeNull();

    const done = fullDb({ trips: [tripRow({ trip_status: TRIP_STATUS.COMPLETED })] });
    const result = await evaluateLiveTripMonitor(done.db, { tripId: 101, now: NOW });
    expect(result).toMatchObject({ tripId: 101, live: false });
  });

  it("a healthy trip is NORMAL with a live ETA and writes no alerts", async () => {
    const { db, table } = fullDb({
      trips: [tripRow()],
      nextDispatch: [{
        dispatch_id: 77,
        vehicle_id: 5,
        driver_id: 7,
        scheduled_departure: "2026-09-08T13:00:00+08:00",
        scheduled_arrival: "2026-09-08T14:00:00+08:00",
        pickup_location: "Makati",
        dropoff_location: "CoCo Star Hotel",
      }],
    });
    const result = await evaluateLiveTripMonitor(db, { tripId: 101, now: NOW });

    expect(result.live).toBe(true);
    expect(result.risk).toBe("NORMAL");
    expect(result.phase).toBe("to_pickup");
    expect(result.liveEta).not.toBeNull();
    // No TomTom key in tests → haversine fallback, honestly labelled.
    expect(result.provenance.eta).toBe("fallback");
    expect(result.nextDispatch).toMatchObject({ dispatchId: 77, pickupLocation: "Makati" });
    expect(table.state.size).toBe(0);
    expect(db.calls.some((c) => c.sql.includes("INSERT INTO notifications"))).toBe(false);
  });

  it("a trip with no GPS becomes UNKNOWN and raises a gps_unavailable alert", async () => {
    libQuery.mockImplementation(async () => ({ rows: [{ employee_id: 3 }] }));
    const { db, table } = fullDb({ trips: [tripRow({ gps_pings: [] })] });
    const result = await evaluateLiveTripMonitor(db, { tripId: 101, now: NOW });

    expect(result.risk).toBe("UNKNOWN");
    expect(result.liveEta).toBeNull();
    expect(result.gps.health).toBe("no-signal");
    expect(table.state.get("gps_unavailable")).toMatchObject({ severity: "ATTENTION", active: true });
    const inserts = db.calls.filter((c) => c.sql.includes("INSERT INTO notifications"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[3]).toBe("Warning");
  });
});

// ─── CHEAP fleet summary (review correction #4) ─────────────────────────────

describe("summarizeFleet — cheap triage", () => {
  it("makes NO TomTom calls and elevates from durable alert severity", async () => {
    const healthy = tripRow({ trip_id: 201 });
    const troubled = tripRow({
      trip_id: 202,
      plate_number: "XYZ 9999",
      gps_pings: [ping(ON_ROUTE, 10 * 60 * 1000)], // 10 min old → stale
    });
    const table = alertTable(202);
    table.state.set("next_trip_risk", {
      alert_id: 9, trip_id: 202, severity: "ACTION", active: true,
    });

    const handlers = [
      ["FROM trips t", () => ({ rows: [healthy, troubled] })],
      ["FROM routes r", () => ({ rows: [ROUTE_LOCATIONS_ROW] })],
      ...table.handlers,
    ];
    const db = makeDb(handlers);
    const { trips } = await summarizeFleet(db, { now: NOW });

    expect(fetchTomTomRoute).not.toHaveBeenCalled();
    expect(trips).toHaveLength(2);
    // Worst first: the elevated ACTION trip sorts above everything else.
    expect(trips[0].tripId).toBe(202);
    expect(trips[0].risk).toBe("ACTION");
    expect(trips[0].reasons.some((r) => r.includes("Active alert"))).toBe(true);
    expect(trips[0].activeAlerts).toEqual([
      expect.objectContaining({ key: "next_trip_risk", severity: "ACTION" }),
    ]);
    // The healthy trip's ETA is unknown in the cheap pass — honest, not NORMAL.
    expect(trips[1].risk).toBe("UNKNOWN");
    expect(trips[1].provenance.eta).toBe("unknown");
    // The defensive sweep ran (backstop; lifecycle is the authoritative one).
    expect(db.calls.some((c) => c.sql.includes("NOT EXISTS"))).toBe(true);
  });

  it("returns an empty fleet when nothing is live", async () => {
    const db = makeDb([["FROM trips t", () => ({ rows: [] })]]);
    const { trips } = await summarizeFleet(db, { now: NOW });
    expect(trips).toEqual([]);
  });
});

// ─── Ingest evaluation + corridor pinning (review correction #2) ────────────

describe("evaluatePingMonitor — off-route over DB breadcrumbs", () => {
  function pingDb(table = alertTable()) {
    const trip = tripRow();
    const db = makeDb([
      ["FROM trips t", () => ({ rows: [trip] })],
      ["FROM routes r", () => ({ rows: [ROUTE_LOCATIONS_ROW] })],
      ...table.handlers,
    ]);
    return { db, table, trip };
  }

  beforeEach(() => {
    fetchTomTomRoute.mockImplementation(async () => ({
      durationMin: 6,
      trafficDelayMin: 0,
      distanceKm: 1.1,
      coordinates: CORRIDOR,
      provenance: "live",
    }));
  });

  it("confirms a deviation on the SECOND consecutive ping, keeps the corridor pinned", async () => {
    const { db, table, trip } = pingDb();

    // Ping 1: on-route — pins the corridor geometry.
    trip.gps_pings = [ping(ON_ROUTE)];
    const first = await evaluatePingMonitor(db, { tripId: 101, now: NOW });
    expect(first.offRoute.state).toBe("on_route");
    expect(fetchTomTomRoute).toHaveBeenCalledTimes(1);

    // Ping 2 + 3: two consecutive fixes ~334 m off the PINNED corridor.
    trip.gps_pings = [ping(FAR_OFF), ping(FAR_OFF, 30_000)];
    const second = await evaluatePingMonitor(db, { tripId: 101, now: NOW });
    expect(second.offRoute.state).toBe("off_route");
    expect(second.risk).toBe("ATTENTION");
    // The corridor must NOT have been re-anchored at the deviated position —
    // that would launder the deviation into "on route".
    expect(fetchTomTomRoute).toHaveBeenCalledTimes(1);
    expect(table.state.get("off_route")).toMatchObject({ severity: "ATTENTION", active: true });
  });

  it("a single >250 m ping does NOT confirm (first evidence waits for a second)", async () => {
    const { db, trip } = pingDb();
    trip.gps_pings = [ping(ON_ROUTE)];
    await evaluatePingMonitor(db, { tripId: 101, now: NOW });

    trip.gps_pings = [ping(FAR_OFF), ping(ON_ROUTE, 30_000)];
    const result = await evaluatePingMonitor(db, { tripId: 101, now: NOW });
    expect(result.offRoute.state).toBe("on_route");
  });

  it("a confirmed deviation persists through one recovery ping and resolves on two", async () => {
    const { db, table, trip } = pingDb();

    // Establish the confirmed deviation (two off-route pings).
    trip.gps_pings = [ping(FAR_OFF), ping(FAR_OFF, 30_000)];
    await evaluatePingMonitor(db, { tripId: 101, now: NOW });
    expect(table.state.get("off_route")?.active).toBe(true);

    // One recovery ping: hysteresis keeps the deviation (previousState comes
    // from the durable row, not this request's opinion).
    trip.gps_pings = [ping(NEAR)];
    const first = await evaluatePingMonitor(db, { tripId: 101, now: NOW });
    expect(first.offRoute.state).toBe("off_route");
    expect(table.state.get("off_route").active).toBe(true);

    // Two consecutive fixes back within ~150 m: resolved.
    trip.gps_pings = [ping(NEAR), ping(NEAR, 30_000)];
    const second = await evaluatePingMonitor(db, { tripId: 101, now: NOW });
    expect(second.offRoute.state).toBe("on_route");
    expect(table.state.get("off_route").active).toBe(false);
  });

  it("serves the delay leg from cache only — never a fresh TomTom call per ping", async () => {
    const { db, trip } = pingDb();
    trip.gps_pings = [ping(ON_ROUTE)];
    const result = await evaluatePingMonitor(db, { tripId: 101, now: NOW });
    // Exactly one fetch: the corridor pin. The ETA leg was not fetched.
    expect(fetchTomTomRoute).toHaveBeenCalledTimes(1);
    expect(result.trafficDelayMin).toBeNull();
  });
});

// ─── Lifecycle-owned resolution (review correction #5) ──────────────────────

describe("resolveMonitorAlerts / sweepStaleMonitorAlerts", () => {
  it("resolves all active alerts for a trip (lifecycle transition)", async () => {
    const db = makeDb([["UPDATE trip_monitor_alerts", () => ({ rows: [{}, {}, {}] })]]);
    const count = await resolveMonitorAlerts(db, 101, "trip_completed", NOW);
    expect(count).toBe(3);
    const call = db.calls.find((c) => c.sql.includes("UPDATE trip_monitor_alerts"));
    expect(call.params[2]).toBe("trip_completed");
    expect(call.sql).toContain("WHERE trip_id = $1 AND active");
  });

  it("sweep only touches alerts whose trip left the live statuses", async () => {
    const db = makeDb([["UPDATE trip_monitor_alerts", () => ({ rows: [{}] })]]);
    const count = await sweepStaleMonitorAlerts(db, NOW);
    expect(count).toBe(1);
    const call = db.calls.find((c) => c.sql.includes("UPDATE trip_monitor_alerts"));
    expect(call.sql).toContain("NOT EXISTS");
    expect(call.sql).toContain("ANY($1)");
  });
});
