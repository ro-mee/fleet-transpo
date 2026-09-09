// Tests for the time-driven trip start-window producer
// (src/services/start-window-notifications.service.js).
//
// Contracts pinned (implementation plan §15, every scenario):
// - Driver Accepted ONLY is eligible (the scan SQL enforces it);
// - three thresholds with the right tier: window open (quiet Warning /
//   heads-up channel), departure due (loud Alert / default), overdue
//   (driver + dispatcher staff copy; management/system_admin never);
// - catch-up: both thresholds crossed in one scan → only the later event;
// - dedupe on repeated scans via the (employee, title, reference) re-check
//   INSIDE the advisory-lock transaction;
// - concurrency: the per-trip advisory lock is taken before the dedupe
//   check and inserts;
// - notification preferences honored (in_app suppresses the notifications
//   row, push suppresses the outbox row);
// - deep-link reference_type 'trip' + reference_id = trip_id everywhere;
// - targeted outbox flush (only the affected employees);
// - push failure never fails the scan, and one trip's error never stops
//   the others;
// - policy buffers flow through to the window (parity with the start gate).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as db from "@/lib/db";
import * as pushService from "@/services/push.service";
import { computeDepartureWindow } from "@/lib/scheduling/departure-window";
import { resolveStartWindow } from "@/lib/scheduling/start-window";

import {
  syncStartWindowNotifications,
  processTrip,
  loadEligibleTrips,
  THRESHOLD_EVENTS,
  locationIsStale,
  STALE_LOCATION_MINUTES,
} from "./start-window-notifications.service";

// The clock the scan runs at. Pickup is 12:30 Manila (04:30 UTC).
const NOW = new Date("2026-09-09T04:00:00.000Z");
const PICKUP = "2026-09-09T04:30:00.000Z";

// TomTom never answers (fetch not ok) → the haversine ladder rung decides.
// Driver sits AT the pickup, so the heuristic ETA is the 1-minute floor:
// recommended = pickup − 1 − 10, earliest = pickup − 1 − 10 − 10, latest = pickup.
const FETCH_FAIL = async () => ({ ok: false });

function tripRow(overrides = {}) {
  return {
    trip_id: 101,
    driver_id: 7,
    driver_employee_id: 77,
    driver_name: "Juan Dela Cruz",
    pickup: PICKUP,
    estimated_duration: null,
    current_latitude: 14.5,
    current_longitude: 121.0,
    pickup_latitude: 14.5,
    pickup_longitude: 121.0,
    // Fresh at every clock the tests run at (NOW 04:00 through LATEST 04:30
    // is 31 min — that test doesn't assert staleLocation, and the ones that
    // do run at/before 04:08, within the 10-minute window).
    last_location_update: "2026-09-09T03:59:00.000Z",
    ...overrides,
  };
}

// Window thresholds for the fixture (eta 1, buffers 10/10).
const EARLIEST = new Date(new Date(PICKUP).getTime() - 21 * 60 * 1000);
const RECOMMENDED = new Date(new Date(PICKUP).getTime() - 11 * 60 * 1000);
const LATEST = new Date(PICKUP);

/** db.query mock that routes by SQL fragment. */
function mockQuery(handlers = []) {
  const fn = vi.fn(async (text) => {
    for (const [fragment, result] of handlers) {
      if (String(text).includes(fragment)) return result;
    }
    return { rows: [] };
  });
  vi.spyOn(db, "query").mockImplementation(fn);
  return fn;
}

/**
 * withTransaction mock. Records every tx call as { text, params } in order
 * and routes responses by SQL fragment (default: no rows — so the dedupe
 * check finds nothing and inserts proceed).
 */
function mockTransaction(handlers = []) {
  const txCalls = [];
  vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => {
    const tx = {
      query: async (text, params = []) => {
        const call = { text: String(text), params };
        txCalls.push(call);
        for (const [fragment, result] of handlers) {
          if (call.text.includes(fragment)) return result;
        }
        return { rows: [] };
      },
    };
    return fn(tx);
  });
  return txCalls;
}

const inserts = (txCalls, table) =>
  txCalls.filter((c) => c.text.startsWith(`INSERT INTO ${table}`));

beforeEach(() => {
  vi.spyOn(pushService, "flushOutbox").mockResolvedValue([]);
  // Default DB: no eligible trips (every route-by-fragment falls through to
  // { rows: [] }, which also means no dispatch policy row → defaults).
  mockQuery();
  mockTransaction();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadEligibleTrips — Driver Accepted only", () => {
  it("scans only Driver Accepted, never the earlier lifecycle states", async () => {
    const fn = mockQuery();
    await loadEligibleTrips();
    const sql = String(fn.mock.calls[0][0]);
    expect(sql).toContain("trip_status = 'Driver Accepted'");
    // The pre-acceptance states must not appear as eligibility branches.
    expect(sql).not.toContain("'Driver Assigned'");
    expect(sql).not.toContain("'Dispatched'");
  });

  it("a trip that started or was cancelled between scans is invisible to the scan", async () => {
    // Enforced by the same SQL filter: Trip Started / Cancelled rows are
    // never returned, so no later notification can be produced for them.
    const fn = mockQuery();
    const out = await syncStartWindowNotifications({ now: NOW, fetchImpl: FETCH_FAIL });
    expect(out).toEqual({ created: 0, pushes_attempted: 0, skipped: 0, errors: 0, stale_locations: 0 });
    const scanSql = fn.mock.calls.map((c) => String(c[0])).find((s) => s.includes("FROM trips t"));
    expect(scanSql).toContain("trip_status = 'Driver Accepted'");
  });
});

describe("processTrip — thresholds and tiers", () => {
  const POLICY = { departureBufferMinutes: 10, earlyStartAllowanceMinutes: 10 };

  it("earliest_start crossed → quiet window-open (Warning, heads-up channel)", async () => {
    const txCalls = mockTransaction();
    const out = await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: EARLIEST, fetchImpl: FETCH_FAIL, // inside [earliest, recommended)
    });
    expect(out.created).toBe(2); // notification row + outbox row
    expect(out.skipped).toBe(false);
    expect(inserts(txCalls, "notifications")).toHaveLength(1);
    const outbox = inserts(txCalls, "push_outbox");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].params[3]).toBe("heads-up"); // quiet channel
  });

  it("recommended_departure crossed → loud departure-due, deep-linked to the trip", async () => {
    const txCalls = mockTransaction();
    await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: RECOMMENDED, fetchImpl: FETCH_FAIL, // inside [recommended, latest)
    });
    const notif = inserts(txCalls, "notifications");
    expect(notif).toHaveLength(1);
    expect(notif[0].params[1]).toBe("Time to Head to Pickup");
    expect(notif[0].params[3]).toBe("Alert");
    expect(notif[0].text).toContain("'trip'");     // reference_type
    expect(notif[0].params[4]).toBe(101);          // reference_id = trip_id
    const outbox = inserts(txCalls, "push_outbox");
    expect(outbox[0].params[1]).toBe("Time to Head to Pickup");
    expect(outbox[0].params[3]).toBe("default");   // loud channel
    expect(outbox[0].params[4]).toBe(101);
  });

  it("latest_start crossed → overdue: driver copy + dispatcher staff copy", async () => {
    const txCalls = mockTransaction();
    await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [],
      dispatcherIds: [55, 56], // dispatchers (management/system_admin stripped upstream by notificationRolesFor)
      now: LATEST, fetchImpl: FETCH_FAIL,
    });
    const notif = inserts(txCalls, "notifications");
    expect(notif).toHaveLength(3); // driver + 2 dispatchers
    const titles = notif.map((c) => c.params[1]);
    expect(titles).toContain("Trip Has Not Started");
    expect(titles.filter((t) => t === "Scheduled Trip Has Not Started")).toHaveLength(2);
    // Every row deep-links to the trip and is addressed per employee.
    for (const c of notif) {
      expect(c.text).toContain("'trip'");
      expect(c.params[4]).toBe(101);
    }
    expect(new Set(notif.map((c) => c.params[0]))).toEqual(new Set([77, 55, 56]));
  });

  it("no threshold crossed → nothing inserted, trip skipped", async () => {
    const txCalls = mockTransaction();
    const out = await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: new Date(EARLIEST.getTime() - 60 * 1000), // before the window
      fetchImpl: FETCH_FAIL,
    });
    expect(out).toEqual({ created: 0, pushRecipients: [], skipped: true, staleLocation: false });
    expect(txCalls.filter((c) => c.text.includes("INSERT INTO"))).toHaveLength(0);
  });

  it("ETA unresolvable → only the overdue threshold can fire (latest_start is the pickup)", async () => {
    const blind = { current_latitude: null, current_longitude: null, estimated_duration: null, pickup_latitude: null, pickup_longitude: null };
    const atOverdue = await processTrip({
      trip: tripRow(blind), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: LATEST, fetchImpl: FETCH_FAIL,
    });
    expect(atOverdue.created).toBeGreaterThan(0);
    const beforePickup = await processTrip({
      trip: tripRow(blind), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: RECOMMENDED, // before pickup, but no ETA → no window thresholds
      fetchImpl: FETCH_FAIL,
    });
    expect(beforePickup.created).toBe(0);
    expect(beforePickup.skipped).toBe(true);
  });

  it("catch-up: now past recommended (both early thresholds crossed) → only departure_due", async () => {
    const txCalls = mockTransaction();
    await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: new Date(RECOMMENDED.getTime() + 60 * 1000), // past recommended, before latest
      fetchImpl: FETCH_FAIL,
    });
    const titles = inserts(txCalls, "notifications").map((c) => c.params[1]);
    expect(titles).toEqual(["Time to Head to Pickup"]); // NOT also "Trip Start Window Open"
  });

  it("catch-up: now past latest → only overdue, never the earlier events", async () => {
    const txCalls = mockTransaction();
    await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: new Date(LATEST.getTime() + 60 * 1000),
      fetchImpl: FETCH_FAIL,
    });
    const titles = inserts(txCalls, "notifications").map((c) => c.params[1]);
    expect(titles).toEqual(["Trip Has Not Started"]);
  });

  it("policy buffers flow through to the window (parity with the start gate's math)", async () => {
    // The start route passes policy.departureBufferMinutes /
    // earlyStartAllowanceMinutes into the same resolver; a different policy
    // must shift the notification threshold by exactly the same amount.
    const policy = { departureBufferMinutes: 5, earlyStartAllowanceMinutes: 5 };
    const gate = await resolveStartWindow({
      pickup: PICKUP,
      driverPosition: [14.5, 121.0],
      pickupPosition: [14.5, 121.0],
      storedDurationMinutes: null,
      ...policy,
      fetchImpl: FETCH_FAIL,
    });
    const expected = computeDepartureWindow({ pickup: PICKUP, etaMinutes: gate.eta_minutes, ...policy });
    expect(gate.earliest_start.getTime()).toBe(expected.earliest_start.getTime());

    // Tighter buffers open the window LATER: the clock that fired
    // window_open under the default 10/10 policy is now BEFORE the window.
    // eta 1 → default earliest = pickup − 21 min, policy earliest = pickup − 11 min.
    const out = await processTrip({
      trip: tripRow(), policy, preferenceRows: [], dispatcherIds: [],
      now: EARLIEST, // window_open with 10/10, too early with 5/5
      fetchImpl: FETCH_FAIL,
    });
    expect(out.created).toBe(0);
    expect(out.skipped).toBe(true);
  });
});

describe("processTrip — dedupe and concurrency", () => {
  const POLICY = { departureBufferMinutes: 10, earlyStartAllowanceMinutes: 10 };

  it("skips an event the driver was already notified of (no duplicate on repeated scans)", async () => {
    // The dedupe query (inside the tx) finds an existing row for
    // (employee, title, trip).
    const txCalls = mockTransaction([["FROM notifications", { rows: [{ 1: 1 }] }]]);
    const out = await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: EARLIEST, fetchImpl: FETCH_FAIL,
    });
    expect(out.created).toBe(0);
    expect(out.skipped).toBe(true);
    expect(txCalls.filter((c) => c.text.includes("INSERT INTO"))).toHaveLength(0);
  });

  it("takes the per-trip advisory lock BEFORE the dedupe check and any insert", async () => {
    const txCalls = mockTransaction([["FROM notifications", { rows: [{ 1: 1 }] }]]);
    await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: EARLIEST, fetchImpl: FETCH_FAIL,
    });
    expect(txCalls[0].text).toContain("pg_advisory_xact_lock");
    expect(txCalls[0].text).toContain("trip_start_notif_");
    expect(txCalls[0].params).toContain(101);
    expect(txCalls[1].text).toContain("FROM notifications"); // dedupe AFTER the lock
  });

  it("a deduped event inserts and updates nothing — unsent notifications elsewhere are never marked pushed", async () => {
    const txCalls = mockTransaction([["FROM notifications", { rows: [{ 1: 1 }] }]]);
    await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], dispatcherIds: [],
      now: EARLIEST, fetchImpl: FETCH_FAIL,
    });
    expect(txCalls.filter((c) => /^(INSERT|UPDATE)/.test(c.text))).toHaveLength(0);
  });
});

describe("processTrip — notification preferences", () => {
  const POLICY = { departureBufferMinutes: 10, earlyStartAllowanceMinutes: 10 };

  it("push disabled → notification row only, no outbox row", async () => {
    const txCalls = mockTransaction();
    await processTrip({
      trip: tripRow(), policy: POLICY,
      preferenceRows: [{ employee_id: 77, event_key: "trip_start_window", channel: "push", enabled: false }],
      dispatcherIds: [], now: EARLIEST, fetchImpl: FETCH_FAIL,
    });
    expect(inserts(txCalls, "notifications")).toHaveLength(1);
    expect(inserts(txCalls, "push_outbox")).toHaveLength(0);
  });

  it("in_app disabled → outbox row only, no notifications row", async () => {
    const txCalls = mockTransaction();
    const out = await processTrip({
      trip: tripRow(), policy: POLICY,
      preferenceRows: [{ employee_id: 77, event_key: "trip_start_window", channel: "in_app", enabled: false }],
      dispatcherIds: [], now: EARLIEST, fetchImpl: FETCH_FAIL,
    });
    expect(inserts(txCalls, "notifications")).toHaveLength(0);
    expect(inserts(txCalls, "push_outbox")).toHaveLength(1);
    expect(out.pushRecipients).toEqual([77]);
  });

  it("both channels disabled → nothing at all", async () => {
    const txCalls = mockTransaction();
    const out = await processTrip({
      trip: tripRow(), policy: POLICY,
      preferenceRows: [
        { employee_id: 77, event_key: "trip_start_window", channel: "push", enabled: false },
        { employee_id: 77, event_key: "trip_start_window", channel: "in_app", enabled: false },
      ],
      dispatcherIds: [], now: EARLIEST, fetchImpl: FETCH_FAIL,
    });
    expect(out.created).toBe(0);
    expect(out.skipped).toBe(true);
    expect(txCalls.filter((c) => c.text.includes("INSERT INTO"))).toHaveLength(0);
  });

  it("absent preference rows inherit the NOTIFICATION_EVENTS defaults (both on)", async () => {
    const txCalls = mockTransaction();
    await processTrip({
      trip: tripRow(), policy: POLICY, preferenceRows: [], // nothing customized
      dispatcherIds: [], now: EARLIEST, fetchImpl: FETCH_FAIL,
    });
    expect(inserts(txCalls, "notifications")).toHaveLength(1);
    expect(inserts(txCalls, "push_outbox")).toHaveLength(1);
  });
});

describe("syncStartWindowNotifications — orchestration", () => {
  it("emits for a crossed trip and flushes the outbox targeted at the affected employees only", async () => {
    mockQuery([["FROM trips t", { rows: [tripRow()] }]]);
    mockTransaction();
    const out = await syncStartWindowNotifications({ now: RECOMMENDED, fetchImpl: FETCH_FAIL });
    expect(out.created).toBe(2); // notification + outbox
    expect(out.pushes_attempted).toBe(1);
    expect(out.skipped).toBe(0);
    expect(pushService.flushOutbox).toHaveBeenCalledTimes(1);
    // The driver only — targeted, never a global flush.
    expect(pushService.flushOutbox).toHaveBeenCalledWith({ employeeIds: [77] });
  });

  it("repeated scans do not duplicate (dedupe path counts as skipped, no flush)", async () => {
    mockQuery([["FROM trips t", { rows: [tripRow()] }]]);
    mockTransaction([["FROM notifications", { rows: [{ 1: 1 }] }]]);
    const out = await syncStartWindowNotifications({ now: RECOMMENDED, fetchImpl: FETCH_FAIL });
    expect(out.created).toBe(0);
    expect(out.skipped).toBe(1);
    expect(pushService.flushOutbox).not.toHaveBeenCalled();
  });

  it("a push flush failure never fails the scan", async () => {
    mockQuery([["FROM trips t", { rows: [tripRow()] }]]);
    mockTransaction();
    pushService.flushOutbox.mockRejectedValue(new Error("Expo is down"));

    const out = await syncStartWindowNotifications({ now: RECOMMENDED, fetchImpl: FETCH_FAIL });
    expect(out.created).toBe(2); // rows were still created and reported
    expect(out.pushes_attempted).toBe(1);
    expect(out.errors).toBe(0);
  });

  it("one trip's failure never stops the scan for the others", async () => {
    mockQuery([
      ["FROM trips t", { rows: [tripRow({ trip_id: 201 }), tripRow({ trip_id: 202, driver_employee_id: 88 })] }],
    ]);
    // First transaction (trip 201) explodes; the second must still run.
    let calls = 0;
    vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => {
      calls += 1;
      if (calls === 1) throw new Error("lock timeout");
      const tx = { query: async () => ({ rows: [] }) };
      return fn(tx);
    });

    const out = await syncStartWindowNotifications({ now: RECOMMENDED, fetchImpl: FETCH_FAIL });
    expect(out.errors).toBe(1);
    expect(out.created).toBeGreaterThanOrEqual(1); // trip 202 still notified
  });

  it("no eligible trips → all zeroes and no flush", async () => {
    mockQuery();
    const out = await syncStartWindowNotifications({ now: NOW, fetchImpl: FETCH_FAIL });
    expect(out).toEqual({ created: 0, pushes_attempted: 0, skipped: 0, errors: 0, stale_locations: 0 });
    expect(pushService.flushOutbox).not.toHaveBeenCalled();
  });

  it("a total DB failure returns counters, never throws", async () => {
    vi.spyOn(db, "query").mockRejectedValue(new Error("connection refused"));
    const out = await syncStartWindowNotifications({ now: NOW, fetchImpl: FETCH_FAIL });
    expect(out).toEqual({ created: 0, pushes_attempted: 0, skipped: 0, errors: 1, stale_locations: 0 });
  });
});

describe("locationIsStale — the staleness watch item", () => {
  const NOW = new Date("2026-09-09T04:00:00.000Z");
  const minsAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);

  it("a position with a fresh last_location_update is not stale", () => {
    expect(locationIsStale({ current_latitude: 14.5, current_longitude: 121, last_location_update: minsAgo(3) }, NOW)).toBe(false);
  });

  it("a position older than STALE_LOCATION_MINUTES is stale (the window was based on where the driver WAS)", () => {
    expect(locationIsStale({ current_latitude: 14.5, current_longitude: 121, last_location_update: minsAgo(STALE_LOCATION_MINUTES + 1) }, NOW)).toBe(true);
  });

  it("a position with no last_location_update is stale — the age is unknown", () => {
    expect(locationIsStale({ current_latitude: 14.5, current_longitude: 121, last_location_update: null }, NOW)).toBe(true);
  });

  it("a missing position is NOT stale — that trip's ETA used the stored duration, no location at all", () => {
    expect(locationIsStale({ current_latitude: null, current_longitude: null, last_location_update: minsAgo(3) }, NOW)).toBe(false);
  });

  it("the scan query selects last_location_update, and stale trips are counted even when no threshold fires", async () => {
    const fn = mockQuery();
    const stale = tripRow({ last_location_update: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString() });
    fn.mockImplementation(async (text) =>
      String(text).includes("FROM trips t") ? { rows: [stale] } : { rows: [] });
    const out = await syncStartWindowNotifications({ now: NOW, fetchImpl: FETCH_FAIL });
    const scanSql = fn.mock.calls.map((c) => String(c[0])).find((s) => s.includes("FROM trips t"));
    expect(scanSql).toContain("last_location_update");
    // NOW is before the window opens (earliest is 12:09 Manila), so nothing
    // fires — but the stale position is still recorded in the counters.
    expect(out).toEqual({ created: 0, pushes_attempted: 0, skipped: 1, errors: 0, stale_locations: 1 });
  });
});

describe("THRESHOLD_EVENTS — tier mapping", () => {
  it("window open is the quiet tier; departure due and overdue are the loud tier", () => {
    expect(THRESHOLD_EVENTS.window_open.type).toBe("Warning");
    expect(THRESHOLD_EVENTS.window_open.channel).toBe("heads-up");
    expect(THRESHOLD_EVENTS.departure_due.type).toBe("Alert");
    expect(THRESHOLD_EVENTS.departure_due.channel).toBe("default");
    expect(THRESHOLD_EVENTS.overdue.type).toBe("Alert");
    expect(THRESHOLD_EVENTS.overdue.channel).toBe("default");
  });

  it("event keys match the NOTIFICATION_EVENTS preference keys", async () => {
    const { NOTIFICATION_EVENTS } = await import("@/lib/constants");
    for (const e of Object.values(THRESHOLD_EVENTS)) {
      expect(NOTIFICATION_EVENTS[e.eventKey], e.eventKey).toBeDefined();
      expect(NOTIFICATION_EVENTS[e.eventKey].label).toBe(e.driverCopy({ pickup: PICKUP }).title);
    }
  });
});
