import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...a) => query(...a) }));

const recordReservationEvent = vi.fn(async () => ({}));
vi.mock("@/services/reservation-events.service", () => ({
  recordReservationEvent: (...a) => recordReservationEvent(...a),
}));

vi.mock("@/lib/integration/category-resolver", () => ({
  resolveVehicleCategory: vi.fn(async () => ({
    categoryId: 7,
    categoryName: "Airport Transfer",
    matchedOn: "requested_vehicle_type",
  })),
}));
vi.mock("@/lib/geo/distance", () => ({
  estimateTrip: vi.fn(() => ({ distanceKm: 12.5, durationMin: 30 })),
}));
vi.mock("@/lib/scheduling/reservation-number", () => ({
  assignReservationNumber: vi.fn(async () => "RSV-2026-0042"),
}));

// status-map is left real — it is a pure mapping and the point of these tests
// is that both doors run the SAME derivation, not what the mapping returns.
import { ingestRequest } from "@/lib/integration/ingest";

const REQUEST = {
  external_booking_id: "BK-2026-00101",
  source_system: "PMS",
  booking_reference: "RES-77120",
  guest_name: "Jordan Rivera",
  pickup_location: "Main Lobby",
  dropoff_location: "NAIA Terminal 3 - Arrivals (Bay 9)",
  pickup_datetime: "2026-08-10T14:30:00+08:00",
  passenger_count: 3,
  special_requests: "2 large suitcases",
  service_type_id: null,
  priority: "Medium",
  booking_status: "Approved",
  requested_vehicle_type: "Airport Transfer Van",
};

function wire({ existing = null } = {}) {
  query.mockImplementation(async (sql, params) => {
    if (sql.includes("SELECT * FROM transportation_requests")) {
      return { rows: existing ? [existing] : [] };
    }
    if (sql.includes("INSERT INTO transportation_requests")) {
      return { rows: [{ request_id: 501, fleet_status: params[12], source_system: params[1] }] };
    }
    return { rows: [{ log_id: 9 }] };
  });
}
const insertCall = () =>
  query.mock.calls.find(([sql]) => sql.includes("INSERT INTO transportation_requests"));
const logCall = () => query.mock.calls.find(([sql]) => sql.includes("INSERT INTO integration_log"));

beforeEach(() => {
  vi.clearAllMocks();
  query.mockReset();
});

describe("ingestRequest", () => {
  it("writes the SAME statement whichever door the request came through", async () => {
    // The item-12 regression: pull inserted 13 columns against push's 19, so a
    // pulled request arrived with no category, estimate or number. Both callers
    // now share one statement, so the two captured SQL strings must be equal.
    wire();
    await ingestRequest(REQUEST, { actor: "gateway:mock", eventType: "transport_request_pulled" });
    const pulled = insertCall();
    const pulledParams = pulled[1];

    vi.clearAllMocks();
    query.mockReset();
    wire();
    await ingestRequest(REQUEST, { actor: "service", eventType: "transport_request_received" });
    const pushed = insertCall();

    expect(pulled[0]).toBe(pushed[0]);
    expect(pulledParams).toEqual(pushed[1]);
    expect(pulledParams).toHaveLength(21);
  });

  it("fills the columns the pull path used to omit", async () => {
    wire();
    await ingestRequest(REQUEST, { actor: "gateway:mock", eventType: "transport_request_pulled" });
    const [sql, params] = insertCall();
    for (const col of ["requested_category_id", "estimated_distance", "estimated_duration", "is_vip", "is_emergency"]) {
      expect(sql).toContain(col);
    }
    expect(params[14]).toBe(7);      // resolved category
    expect(params[15]).toBe(12.5);   // estimated distance
    expect(params[16]).toBe(30);     // estimated duration
    expect(params[17]).toBe(false);  // is_vip absent from payload -> false, not null
    expect(params[18]).toBe(false);
  });

  it("opens the timeline on a pulled request too", async () => {
    wire();
    await ingestRequest(REQUEST, { actor: "gateway:mock", eventType: "transport_request_pulled" });
    expect(recordReservationEvent).toHaveBeenCalledTimes(1);
    const arg = recordReservationEvent.mock.calls[0][0];
    expect(arg.requestId).toBe(501);
    expect(arg.metadata.actor).toBe("gateway:mock");
    expect(arg.metadata.category_matched_on).toBe("requested_vehicle_type");
  });

  it("keeps event_type as the one difference, so pull stays distinguishable", async () => {
    wire();
    await ingestRequest(REQUEST, { eventType: "transport_request_pulled" });
    expect(logCall()[1][1]).toBe("transport_request_pulled");

    vi.clearAllMocks();
    query.mockReset();
    wire();
    await ingestRequest(REQUEST, { eventType: "transport_request_received" });
    expect(logCall()[1][1]).toBe("transport_request_received");
  });

  it("is idempotent on external_booking_id — no second row, no second timeline", async () => {
    wire({ existing: { request_id: 42, external_booking_id: REQUEST.external_booking_id } });
    const out = await ingestRequest(REQUEST, { eventType: "transport_request_pulled" });

    expect(out.idempotent).toBe(true);
    expect(out.request.request_id).toBe(42);
    expect(insertCall()).toBeUndefined();
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("scopes the lookup to authenticated source and avoids a select-only insert race", async () => {
    wire();
    await ingestRequest({ ...REQUEST, external_booking_id: "123", source_system: "POS" });
    const lookup = query.mock.calls.find(([sql]) => sql.includes("SELECT * FROM transportation_requests"));
    expect(lookup[1]).toEqual(["POS", "123"]);
    expect(insertCall()[0]).toMatch(/ON CONFLICT\s*\(source_system, external_request_id\)\s*DO NOTHING/i);
  });

  it("does not reuse a source ID when its original request is soft-deleted", async () => {
    wire({ existing: { request_id: 42, source_system: "PMS", external_request_id: REQUEST.external_booking_id, deleted_at: "2026-10-04T01:00:00Z" } });
    await expect(ingestRequest(REQUEST)).rejects.toMatchObject({ code: "SOURCE_ID_TOMBSTONED" });
    expect(insertCall()).toBeUndefined();
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("rejects a v2 create reusing an ID with changed passenger details", async () => {
    wire();
    const old = { ...REQUEST, source_system: "POS", external_booking_id: "123", pickup_location: "Old lobby" };
    await ingestRequest(old, { strictReplay: true });
    const originalFingerprint = insertCall()[1].at(-1);
    query.mockClear();
    wire({ existing: { request_id: 42, source_system: "POS", external_request_id: "123", external_create_fingerprint: originalFingerprint } });
    await expect(ingestRequest({ ...old, pickup_location: "New lobby" }, { strictReplay: true }))
      .rejects.toMatchObject({ code: "SOURCE_CREATE_CONFLICT" });
    expect(insertCall()).toBeUndefined();
  });

  it("does not pretend an archived v1 row with no fingerprint matches a v2 create", async () => {
    wire({ existing: { request_id: 42, source_system: "PMS", external_request_id: REQUEST.external_booking_id, external_create_fingerprint: null } });
    await expect(ingestRequest(REQUEST, { strictReplay: true })).rejects.toMatchObject({ code: "SOURCE_CREATE_CONFLICT" });
    expect(insertCall()).toBeUndefined();
  });

  it("persists a v2 create fingerprint for exact replay validation", async () => {
    wire();
    await ingestRequest({ ...REQUEST, source_system: "POS", external_booking_id: "123" }, { strictReplay: true });
    const [sql, params] = insertCall();
    expect(sql).toContain("external_create_fingerprint");
    expect(params.at(-1)).toMatch(/^[a-f0-9]{64}$/);
    const fingerprint = params.at(-1);
    query.mockClear();
    wire({ existing: { request_id: 42, source_system: "POS", external_request_id: "123", external_create_fingerprint: fingerprint } });
    const replay = await ingestRequest({ ...REQUEST, source_system: "POS", external_booking_id: "123" }, { strictReplay: true });
    expect(replay).toMatchObject({ idempotent: true, request: { request_id: 42 } });
    expect(insertCall()).toBeUndefined();
  });

  it("returns the winner after a concurrent insert conflict without another timeline event", async () => {
    let lookups = 0;
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT * FROM transportation_requests")) {
        lookups += 1;
        return { rows: lookups === 1 ? [] : [{ request_id: 502, source_system: "PMS", external_request_id: REQUEST.external_booking_id }] };
      }
      if (sql.includes("INSERT INTO transportation_requests")) return { rows: [] };
      return { rows: [] };
    });
    const out = await ingestRequest(REQUEST);
    expect(out).toMatchObject({ idempotent: true, request: { request_id: 502 } });
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("rejects a different v2 create whose original ID wins an insert race", async () => {
    wire();
    const old = { ...REQUEST, source_system: "POS", external_booking_id: "123", pickup_location: "Old lobby" };
    await ingestRequest(old, { strictReplay: true });
    const originalFingerprint = insertCall()[1].at(-1);
    query.mockClear();
    recordReservationEvent.mockClear();
    let lookups = 0;
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT * FROM transportation_requests")) {
        lookups += 1;
        return { rows: lookups === 1 ? [] : [{ request_id: 502, external_create_fingerprint: originalFingerprint }] };
      }
      if (sql.includes("INSERT INTO transportation_requests")) return { rows: [] };
      return { rows: [] };
    });
    await expect(ingestRequest({ ...old, pickup_location: "New lobby" }, { strictReplay: true }))
      .rejects.toMatchObject({ code: "SOURCE_CREATE_CONFLICT" });
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("rejects a tombstone that wins a concurrent insert race", async () => {
    let lookups = 0;
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT * FROM transportation_requests")) {
        lookups += 1;
        return { rows: lookups === 1 ? [] : [{ request_id: 502, deleted_at: "2026-10-04T01:00:00Z" }] };
      }
      if (sql.includes("INSERT INTO transportation_requests")) return { rows: [] };
      return { rows: [] };
    });
    await expect(ingestRequest(REQUEST)).rejects.toMatchObject({ code: "SOURCE_ID_TOMBSTONED" });
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("does not fail the ingest when the integration_log write fails", async () => {
    // Best-effort by design: the request is already committed, and losing the
    // reconciliation line must not turn a successful ingest into a 500.
    wire();
    query.mockImplementation(async (sql, params) => {
      if (sql.includes("SELECT * FROM transportation_requests")) return { rows: [] };
      // Route estimation now checks active locations before falling back to
      // the deterministic estimator. That lookup is unrelated to the failure
      // being simulated here, so let it return no matches.
      if (sql.includes("FROM locations")) return { rows: [] };
      if (sql.includes("INSERT INTO transportation_requests")) {
        return { rows: [{ request_id: 501, fleet_status: params[12], source_system: params[1] }] };
      }
      throw new Error("integration_log is down");
    });

    const out = await ingestRequest(REQUEST, { eventType: "transport_request_pulled" });
    expect(out.idempotent).toBe(false);
    expect(out.request.request_id).toBe(501);
  });
});
