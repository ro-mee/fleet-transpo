import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
const withTransaction = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...a) => query(...a),
  withTransaction: (...args) => withTransaction(...args),
}));

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
const resolveRequestEstimate = vi.fn(async (_request, _db, options = {}) => (
  options.strictRegistry
    ? { distanceKm: null, durationMin: null, source: null }
    : { distanceKm: 12.5, durationMin: 30 }
));
const linkRequestLocations = vi.fn(async () => ({}));
vi.mock("@/services/route-resolver.service", () => ({
  resolveRequestEstimate: (...args) => resolveRequestEstimate(...args),
  linkRequestLocations: (...args) => linkRequestLocations(...args),
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
const PICKUP_CODE = "74dd0286-7124-4123-ae99-6896c82348cb";
const DROPOFF_CODE = "36394b69-57e6-4518-aaca-a755c1754f84";

function wire({ existing = null, service = { service_type_id: 13, default_load_type: "Cargo" }, locations = [] } = {}) {
  query.mockImplementation(async (sql, params) => {
    if (sql.includes("FROM service_types")) return { rows: service ? [service] : [] };
    if (sql.includes("FROM locations")) {
      return { rows: locations.filter((location) => location.location_code === params[0]).slice(0, 1) };
    }
    if (sql.includes("SELECT * FROM transportation_requests")) {
      return { rows: existing ? [existing] : [] };
    }
    if (sql.includes("INSERT INTO transportation_requests")) {
      return { rows: [{
        request_id: 501,
        fleet_status: params[12],
        source_system: params[1],
        pickup_location: params[4],
        dropoff_location: params[5],
        partner_pickup_location_proposal: params[27] == null ? null : JSON.parse(params[27]),
        partner_dropoff_location_proposal: params[28] == null ? null : JSON.parse(params[28]),
      }] };
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
  withTransaction.mockReset().mockImplementation(async (work) => work({ query: (...args) => query(...args) }));
  resolveRequestEstimate.mockReset().mockImplementation(async (_request, _db, options = {}) => (
    options.strictRegistry
      ? { distanceKm: null, durationMin: null, source: null }
      : { distanceKm: 12.5, durationMin: 30 }
  ));
  linkRequestLocations.mockReset().mockResolvedValue({});
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
    expect(pulledParams).toHaveLength(29);
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
    expect(resolveRequestEstimate).toHaveBeenCalledTimes(1);
    expect(linkRequestLocations).toHaveBeenCalledWith(expect.objectContaining({ query: expect.any(Function) }), {
      requestId: 501,
      pickup: REQUEST.pickup_location,
      dropoff: REQUEST.dropoff_location,
    });
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
    const originalFingerprint = insertCall()[1][20];
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
    expect(params[20]).toMatch(/^[a-f0-9]{64}$/);
    const fingerprint = params[20];
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
    const originalFingerprint = insertCall()[1][20];
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

  it("rejects a legacy passenger request whose internal service ID resolves to Cargo", async () => {
    wire({ service: { service_type_id: 13, default_load_type: "Cargo" } });

    await expect(ingestRequest({ ...REQUEST, service_type_id: 13 }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    expect(query.mock.calls.some(([sql]) => sql.includes("service_type_id = $1"))).toBe(true);
    expect(insertCall()).toBeUndefined();
  });

  it("preserves a legacy Passenger service ID when its catalog load type matches", async () => {
    wire({ service: { service_type_id: 13, default_load_type: "Passenger" } });

    await ingestRequest({ ...REQUEST, service_type_id: 13 });

    expect(query.mock.calls.some(([sql]) => sql.includes("service_type_id = $1"))).toBe(true);
    expect(insertCall()[1][9]).toBe(13);
  });

  it("resolves active service code to a database id and persists cargo without a passenger", async () => {
    wire();
    await ingestRequest({ ...REQUEST, passenger_count: null, load_type: "Cargo", service_code: "RESTAURANT_SUPPLY_PICKUP", cargo_weight_kg: 650, cargo_description: "Vegetables", source_department: "Kitchen" }, { strictReplay: true });
    const [sql, params] = insertCall();
    expect(sql).toContain("cargo_weight_kg");
    expect(sql).toContain("cargo_description");
    expect(sql).toContain("source_department");
    expect(sql).toContain("load_type");
    expect(params[7]).toBeNull();
    expect(params[9]).toBe(13);
    expect(params).toContain(650);
    expect(params).toContain("Kitchen");
  });

  it("rejects unknown, inactive and mismatched services without inserting", async () => {
    const cargo = { ...REQUEST, passenger_count: null, load_type: "Cargo", service_code: "RESTAURANT_SUPPLY_PICKUP", cargo_weight_kg: 650, cargo_description: "Vegetables" };
    for (const service of [null, { service_type_id: 13, default_load_type: "Passenger" }]) {
      query.mockReset(); wire({ service });
      await expect(ingestRequest(cargo, { strictReplay: true })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      expect(insertCall()).toBeUndefined();
    }
  });

  it("acknowledges an unchanged historical replay even after its service is disabled", async () => {
    const cargo = { ...REQUEST, passenger_count: null, load_type: "Cargo", service_code: "RESTAURANT_SUPPLY_PICKUP", cargo_weight_kg: 650, cargo_description: "Vegetables" };
    wire(); await ingestRequest(cargo, { strictReplay: true });
    const fingerprint = insertCall()[1].find((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
    query.mockClear(); wire({ existing: { request_id: 42, external_create_fingerprint: fingerprint }, service: null });
    await expect(ingestRequest(cargo, { strictReplay: true })).resolves.toMatchObject({ idempotent: true });
    expect(insertCall()).toBeUndefined();
  });

  it("conflicts on changed cargo weight rather than acknowledging a stale replay", async () => {
    const cargo = { ...REQUEST, passenger_count: null, load_type: "Cargo", service_code: "RESTAURANT_SUPPLY_PICKUP", cargo_weight_kg: 650, cargo_description: "Vegetables" };
    wire();
    await ingestRequest(cargo, { strictReplay: true });
    const fingerprint = insertCall()[1].find((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
    query.mockClear(); wire({ existing: { request_id: 42, external_create_fingerprint: fingerprint } });
    await expect(ingestRequest({ ...cargo, cargo_weight_kg: 651 }, { strictReplay: true })).rejects.toMatchObject({ code: "SOURCE_CREATE_CONFLICT" });
    expect(insertCall()).toBeUndefined();
  });

  it("does not fail the ingest when the integration_log write fails", async () => {
    // Best-effort by design: the request is already committed, and losing the
    // reconciliation line must not turn a successful ingest into a 500.
    wire();
    query.mockImplementation(async (sql, params) => {
      if (sql.includes("SELECT * FROM transportation_requests")) return { rows: [] };
      if (sql.includes("INSERT INTO transportation_requests")) {
        return { rows: [{ request_id: 501, fleet_status: params[12], source_system: params[1] }] };
      }
      throw new Error("integration_log is down");
    });

    const out = await ingestRequest(REQUEST, { eventType: "transport_request_pulled" });
    expect(out.idempotent).toBe(false);
    expect(out.request.request_id).toBe(501);
  });

  it("passes exact active v2 links to strict estimation without name linking", async () => {
    const pickupProposal = { address: "Hotel driveway", latitude: 14.5524, longitude: 121.0198 };
    const dropoffProposal = { address: "Terminal curb", latitude: 14.5086, longitude: 121.0194 };
    const v2 = {
      ...REQUEST,
      external_booking_id: "v2-location-links",
      pickup_location_code: PICKUP_CODE,
      dropoff_location_code: DROPOFF_CODE,
      pickup_location_proposal: pickupProposal,
      dropoff_location_proposal: dropoffProposal,
    };
    wire({ locations: [
      { location_code: PICKUP_CODE, location_id: 31, is_active: true, retired_at: null },
      { location_code: DROPOFF_CODE, location_id: 32, is_active: true, retired_at: null },
    ] });

    await ingestRequest(v2, { strictReplay: true });

    const [sql, params] = insertCall();
    expect(sql).toContain("pickup_location_id");
    expect(sql).toContain("dropoff_location_id");
    expect(sql).toContain("partner_pickup_location_proposal");
    expect(sql).toContain("partner_dropoff_location_proposal");
    expect(params.slice(25)).toEqual([
      31,
      32,
      JSON.stringify(pickupProposal),
      JSON.stringify(dropoffProposal),
    ]);
    expect(params[4]).toBe(REQUEST.pickup_location);
    expect(params[5]).toBe(REQUEST.dropoff_location);
    expect(params[15]).toBeNull();
    expect(params[16]).toBeNull();
    expect(resolveRequestEstimate).toHaveBeenCalledTimes(1);
    expect(resolveRequestEstimate.mock.calls[0][0]).toMatchObject({
      pickup_location_id: 31,
      dropoff_location_id: 32,
      partner_pickup_location_proposal: pickupProposal,
      partner_dropoff_location_proposal: dropoffProposal,
    });
    expect(resolveRequestEstimate.mock.calls[0][2]).toEqual({ persistRoute: true, strictRegistry: true });
    expect(linkRequestLocations).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([statement]) => /INSERT INTO routes/i.test(statement))).toBe(false);
    expect(query.mock.calls.filter(([statement]) => statement.includes("FROM locations"))
      .every(([statement]) => statement.includes("location_code"))).toBe(true);
  });

  it("locks the final active-code checks and inserts through the same transaction", async () => {
    const v2 = {
      ...REQUEST,
      external_booking_id: "v2-locked-location-links",
      pickup_location_code: PICKUP_CODE,
      dropoff_location_code: DROPOFF_CODE,
    };
    wire({ locations: [
      { location_code: PICKUP_CODE, location_id: 31, is_active: true, retired_at: null },
      { location_code: DROPOFF_CODE, location_id: 32, is_active: true, retired_at: null },
    ] });
    const transactionCalls = [];
    withTransaction.mockImplementation(async (work) => work({
      query: async (...args) => {
        transactionCalls.push(args);
        return query(...args);
      },
    }));

    await ingestRequest(v2, { strictReplay: true });

    const lockedLookups = transactionCalls.filter(([sql]) => sql.includes("FROM locations"));
    const transactionInsert = transactionCalls.find(([sql]) => sql.includes("INSERT INTO transportation_requests"));
    expect(lockedLookups).toHaveLength(2);
    expect(lockedLookups.every(([sql]) => /FOR SHARE/i.test(sql))).toBe(true);
    expect(transactionInsert).toBeDefined();
    expect(transactionCalls.indexOf(transactionInsert)).toBeGreaterThan(transactionCalls.indexOf(lockedLookups.at(-1)));
    expect(transactionInsert[1].slice(25, 27)).toEqual([31, 32]);
  });

  it("rejects a location retired before its locked insert without writing the request", async () => {
    const v2 = {
      ...REQUEST,
      external_booking_id: "v2-retired-before-insert",
      pickup_location_code: PICKUP_CODE,
    };
    wire({ locations: [
      { location_code: PICKUP_CODE, location_id: 31, is_active: true, retired_at: null },
    ] });
    const transactionCalls = [];
    withTransaction.mockImplementation(async (work) => work({
      query: async (sql, params) => {
        transactionCalls.push([sql, params]);
        if (sql.includes("FROM locations") && /FOR SHARE/i.test(sql)) {
          return { rows: [{ location_id: 31, is_active: false, retired_at: "2026-10-05T00:00:00Z" }] };
        }
        return query(sql, params);
      },
    }));

    await expect(ingestRequest(v2, { strictReplay: true }))
      .rejects.toMatchObject({ code: "LOCATION_CODE_RETIRED" });

    expect(transactionCalls.some(([sql]) => /FOR SHARE/i.test(sql))).toBe(true);
    expect(transactionCalls.some(([sql]) => sql.includes("INSERT INTO transportation_requests"))).toBe(false);
    expect(insertCall()).toBeUndefined();
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("rejects an unknown v2 location code before inserting or opening the timeline", async () => {
    wire();
    await expect(ingestRequest({ ...REQUEST, pickup_location_code: PICKUP_CODE }, { strictReplay: true }))
      .rejects.toMatchObject({ code: "LOCATION_CODE_UNKNOWN" });
    expect(insertCall()).toBeUndefined();
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("rejects an inactive v2 location code as retired", async () => {
    wire({ locations: [{ location_code: PICKUP_CODE, location_id: 31, is_active: false, retired_at: "2026-10-01T00:00:00Z" }] });
    await expect(ingestRequest({ ...REQUEST, pickup_location_code: PICKUP_CODE }, { strictReplay: true }))
      .rejects.toMatchObject({ code: "LOCATION_CODE_RETIRED" });
    expect(insertCall()).toBeUndefined();
    expect(recordReservationEvent).not.toHaveBeenCalled();
  });

  it("persists proposal-only endpoints unresolved and skips legacy location resolution", async () => {
    const pickupProposal = { address: "Hotel side gate" };
    const dropoffProposal = { latitude: 14.5, longitude: 121.0 };
    wire();
    const result = await ingestRequest({
      ...REQUEST,
      pickup_location_proposal: pickupProposal,
      dropoff_location_proposal: dropoffProposal,
    }, { strictReplay: true });

    const [sql, params] = insertCall();
    expect(params[25]).toBeNull();
    expect(params[26]).toBeNull();
    expect(JSON.parse(params[27])).toEqual(pickupProposal);
    expect(JSON.parse(params[28])).toEqual(dropoffProposal);
    expect(params[15]).toBeNull();
    expect(params[16]).toBeNull();
    expect(resolveRequestEstimate).toHaveBeenCalledTimes(1);
    expect(resolveRequestEstimate.mock.calls[0][0]).toMatchObject({
      pickup_location_id: null,
      dropoff_location_id: null,
      partner_pickup_location_proposal: pickupProposal,
      partner_dropoff_location_proposal: dropoffProposal,
    });
    expect(resolveRequestEstimate.mock.calls[0][2]).toEqual({ persistRoute: true, strictRegistry: true });
    expect(linkRequestLocations).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([statement]) => statement.includes("FROM locations"))).toBe(false);
    expect(sql).toContain("partner_pickup_location_proposal");
    const loggedPayload = JSON.parse(logCall()[1][4]);
    expect(loggedPayload).not.toHaveProperty("pickup_location_proposal");
    expect(loggedPayload).not.toHaveProperty("dropoff_location_proposal");
    expect(result.request).not.toHaveProperty("partner_pickup_location_proposal");
    expect(result.request).not.toHaveProperty("partner_dropoff_location_proposal");
  });

  it("returns an exact v2 replay before looking up a now-retired code", async () => {
    const v2 = { ...REQUEST, pickup_location_code: PICKUP_CODE };
    wire({ locations: [{ location_code: PICKUP_CODE, location_id: 31, is_active: true, retired_at: null }] });
    await ingestRequest(v2, { strictReplay: true });
    const fingerprint = insertCall()[1][20];

    query.mockClear();
    wire({
      existing: { request_id: 42, source_system: "PMS", external_request_id: REQUEST.external_booking_id, external_create_fingerprint: fingerprint },
      locations: [{ location_code: PICKUP_CODE, location_id: 31, is_active: false, retired_at: "2026-10-01T00:00:00Z" }],
    });
    await expect(ingestRequest(v2, { strictReplay: true })).resolves.toMatchObject({ idempotent: true, request: { request_id: 42 } });
    expect(query.mock.calls.some(([statement]) => statement.includes("location_code"))).toBe(false);
    expect(insertCall()).toBeUndefined();
  });

  it.each(["location code", "location proposal"])("includes the %s in v2 create replay fingerprints", async (changed) => {
    const v2 = {
      ...REQUEST,
      source_system: "POS",
      pickup_location_code: PICKUP_CODE,
      pickup_location_proposal: { address: "Original gate" },
    };
    wire({ locations: [{ location_code: PICKUP_CODE, location_id: 31, is_active: true, retired_at: null }] });
    await ingestRequest(v2, { strictReplay: true });
    const fingerprint = insertCall()[1][20];

    const changedRequest = changed === "location code"
      ? { ...v2, pickup_location_code: DROPOFF_CODE }
      : { ...v2, pickup_location_proposal: { address: "Changed gate" } };
    query.mockClear();
    wire({ existing: { request_id: 42, external_create_fingerprint: fingerprint } });
    await expect(ingestRequest(changedRequest, { strictReplay: true })).rejects.toMatchObject({ code: "SOURCE_CREATE_CONFLICT" });
    expect(query.mock.calls.some(([statement]) => statement.includes("location_code"))).toBe(false);
    expect(insertCall()).toBeUndefined();
  });
});
