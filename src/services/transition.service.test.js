// The dispatch stand-down chain.
//
// Contract (both cancel dialogs already promise it): standing a dispatch down
// releases the vehicle and driver, cancels the dispatch's OPEN trips, and leaves
// the guest's request alive — released back to Scheduled and re-assignable.
// Only an explicit request cancellation cancels the request.
//
// It also has to be all-or-nothing: the dispatch flip, the trip stand-down and
// the request release commit in ONE transaction, so a failed release can never
// leave a half-cancelled chain (which is what the previous best-effort sequence
// produced — and it produced it while cancelling the guest's transport).
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as db from "@/lib/db";
import { setDispatchStatus } from "./transition.service";

vi.mock("@/services/status.service", () => ({
  syncVehicleStatus: vi.fn(async () => null),
  syncDriverStatus: vi.fn(async () => null),
  ensureTripForDispatch: vi.fn(async () => null),
}));
vi.mock("@/services/outbound.service", () => ({ emitTransportStatus: vi.fn(async () => null) }));
vi.mock("@/services/push.service", () => ({ sendPush: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => null) }));
vi.mock("@/services/reservation-events.service", () => ({
  recordReservationEvent: vi.fn(async () => ({ recorded: true })),
}));
vi.mock("@/services/priority.service", () => ({
  recomputeDerivedPriority: vi.fn(async () => new Map()),
}));

const { emitTransportStatus } = await import("@/services/outbound.service");
const { writeAudit } = await import("@/lib/audit");
const { recordReservationEvent } = await import("@/services/reservation-events.service");

const DISPATCH = {
  dispatch_id: 55,
  dispatch_number: "DSP-55",
  status: "Scheduled",
  vehicle_id: 5,
  driver_id: 7,
  request_id: 501,
};

const SESSION = { user: { employeeId: 3, role: "dispatcher" } };

/**
 * Fake tx/query pair that tracks every statement and mutates one in-memory
 * request row, so the released fleet_status can be read back the way the real
 * UPDATE ... RETURNING * would give it.
 */
function harness({ requestStatus = "Assigned", dispatchStatus = "Scheduled" } = {}) {
  const current = { request_id: 501, fleet_status: requestStatus, vehicle_id: 5, driver_id: 7 };
  const txLog = [];
  const outsideLog = [];

  const handle = (sql, params, log) => {
    const s = String(sql);
    log.push({ sql: s, params });

    if (s.includes("FOR UPDATE") && s.includes("FROM transportation_requests")) {
      return { rows: [{ ...current }] };
    }
    if (s.includes("SELECT * FROM transportation_requests")) {
      return { rows: [{ ...current }] };
    }
    if (/^UPDATE transportation_requests SET fleet_status = \$1/.test(s.trim())) {
      current.fleet_status = params[0];
      return { rows: [{ ...current }] };
    }
    if (/^UPDATE transportation_requests SET/.test(s.trim())) {
      return { rows: [{ ...current }] };
    }
    if (s.includes("UPDATE dispatchschedules") && s.includes("RETURNING *")) {
      return { rows: [{ ...DISPATCH, status: params[0], cancel_reason: params[1] ?? null }] };
    }
    if (s.includes("FROM dispatchschedules WHERE dispatch_id")) {
      return { rows: [{ ...DISPATCH, status: dispatchStatus }] };
    }
    return { rows: [] };
  };

  vi.spyOn(db, "query").mockImplementation(async (sql, params = []) => handle(sql, params, outsideLog));
  vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => {
    const tx = { query: async (sql, params = []) => handle(sql, params, txLog) };
    return fn(tx);
  });

  return { txLog, outsideLog, request: current };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setDispatchStatus — cancellation releases the request", () => {
  it("releases an Assigned request to Scheduled instead of cancelling it", async () => {
    const h = harness({ requestStatus: "Assigned" });
    const result = await setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: "Vehicle unavailable" });

    const release = h.txLog.find((s) => /^UPDATE transportation_requests SET fleet_status = \$1/.test(s.sql.trim()));
    expect(release, "the request was never released").toBeTruthy();
    expect(release.params[0]).toBe("Scheduled");
    // The guest's transport is NOT cancelled.
    expect(h.txLog.some((s) => s.params.includes("Cancelled") && /^UPDATE transportation_requests/.test(s.sql.trim()))).toBe(false);
    expect(result.status).toBe("Cancelled");
  });

  it("drops the released pair so the request stops advertising it", async () => {
    const h = harness({ requestStatus: "Assigned" });
    await setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: null });

    const release = h.txLog.find((s) => /^UPDATE transportation_requests SET fleet_status/.test(s.sql.trim()));
    expect(release.sql).toContain("vehicle_id = $");
    expect(release.sql).toContain("driver_id = $");
    // Both are explicitly nulled, not left pointing at the released pair.
    expect(release.params.filter((p) => p === null).length).toBeGreaterThanOrEqual(2);
  });

  it("records the stand-down as its own timeline event, with the statuses it moved between", async () => {
    harness({ requestStatus: "Assigned" });
    await setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: "Driver reassigned" });

    expect(recordReservationEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(recordReservationEvent).mock.calls[0][0];
    expect(event.eventType).toBe("dispatch_released");
    expect(event.fromStatus).toBe("Assigned");
    expect(event.toStatus).toBe("Scheduled");
    expect(event.description).toContain("Driver reassigned");
    // Written on the transaction's connection — the timeline cannot outlive a
    // rolled-back release.
    expect(event.db).toBeTruthy();
    expect(event.db.query).toBeTypeOf("function");
  });

  it("cancels the dispatch and its open trips inside the same transaction", async () => {
    const h = harness({ requestStatus: "Assigned" });
    await setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: null });

    const dispatchFlip = h.txLog.find((s) => s.sql.includes("UPDATE dispatchschedules") && s.sql.includes("RETURNING *"));
    expect(dispatchFlip).toBeTruthy();
    expect(dispatchFlip.params[0]).toBe("Cancelled");

    const tripCancel = h.txLog.find((s) => s.sql.includes("UPDATE trips"));
    expect(tripCancel).toBeTruthy();
    // A Completed trip is history: the predicate must never touch it.
    expect(tripCancel.sql).toContain("trip_status NOT IN ('Completed', 'Cancelled')");
    expect(tripCancel.sql).toContain("deleted_at IS NULL");
  });

  it("leaves an already-terminal request alone but still cancels the dispatch", async () => {
    // Live rows exist where the request was cancelled/finished and its dispatch
    // is still open. Standing that dispatch down is legal; the terminally
    // Cancelled request must not be dragged back out of its terminal state.
    const h = harness({ requestStatus: "Cancelled" });
    const result = await setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: "Tidy up" });

    expect(result.status).toBe("Cancelled");
    expect(h.txLog.some((s) => /^UPDATE transportation_requests SET fleet_status/.test(s.sql.trim()))).toBe(false);
    expect(h.txLog.some((s) => s.sql.includes("UPDATE trips"))).toBe(true);
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("keeps a Completed request Completed", async () => {
    const h = harness({ requestStatus: "Completed" });
    await setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: null });
    expect(h.txLog.some((s) => /^UPDATE transportation_requests SET fleet_status/.test(s.sql.trim()))).toBe(false);
  });

  it("aborts the whole chain when the release is refused", async () => {
    // An unknown stored status makes the state machine refuse the hop, which is
    // the "failed request transition" the old code swallowed. It must now roll
    // the dispatch flip and the trip stand-down back with it.
    const h = harness({ requestStatus: "Bogus" });
    await expect(
      setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: null })
    ).rejects.toThrow(/Cannot move a request/);
    // Nothing was committed after the failure: no audit, no Booking notice.
    expect(writeAudit).not.toHaveBeenCalled();
    expect(emitTransportStatus).not.toHaveBeenCalled();
  });

  it("notifies Booking only after the transaction has committed", async () => {
    const h = harness({ requestStatus: "Assigned" });
    let committed = false;
    vi.mocked(emitTransportStatus).mockImplementation(async () => {
      // The tx log is complete (and committed) by the time this runs.
      expect(h.txLog.length).toBeGreaterThan(0);
      committed = true;
      return null;
    });
    await setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: null });
    expect(committed).toBe(true);
    const released = vi.mocked(emitTransportStatus).mock.calls[0][0];
    expect(released.fleet_status).toBe("Scheduled");
  });

  it("audits the request status alongside the dispatch status", async () => {
    harness({ requestStatus: "Assigned" });
    await setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: "Guest no-show" });
    const entry = vi.mocked(writeAudit).mock.calls[0][2];
    expect(entry.oldValues).toMatchObject({ status: "Scheduled", reason: "Guest no-show" });
    expect(entry.newValues).toMatchObject({ status: "Cancelled", request_status: "Scheduled" });
  });

  it("refuses to cancel a dispatch that is already terminal", async () => {
    harness({ dispatchStatus: "Completed" });
    await expect(
      setDispatchStatus({ dispatchId: 55, to: "Cancelled", session: SESSION, reason: null })
    ).rejects.toThrow(/can no longer change status/);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("still flips a non-cancelling dispatch on the pooled connection", async () => {
    const h = harness();
    const result = await setDispatchStatus({ dispatchId: 55, to: "In Progress", session: SESSION, reason: null });
    // No transaction for a plain forward hop, and no request release.
    expect(db.withTransaction).not.toHaveBeenCalled();
    expect(h.txLog).toHaveLength(0);
    expect(result.status).toBe("In Progress");
    expect(h.outsideLog.some((s) => /^UPDATE transportation_requests/.test(s.sql.trim()))).toBe(false);
    expect(recordReservationEvent).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });
});
