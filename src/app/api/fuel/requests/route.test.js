import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  txQuery: vi.fn(),
  blocking: null,
  insertFails: 0,
  closeCount: 0,
  updateRequest: null,
  measuredReceipts: null,
  measuredDistance: null,
  vehicleRow: null,
}));

vi.mock("@/lib/db", () => ({
  query: state.query,
  withTransaction: vi.fn(async (fn) => fn({ query: state.txQuery })),
}));
vi.mock("@/lib/api/utils", () => ({
  AuthError: class AuthError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
  },
  requirePermission: vi.fn(async () => ({ user: { role: "fleet_manager" } })),
  requireDriver: vi.fn(async () => ({ user: { driverId: 11 } })),
  parseBody: vi.fn(),
  ok: (data, status = 200) => Response.json(data, { status }),
  err: (message, status = 400, data = null) =>
    Response.json(data ? { error: message, ...data } : { error: message }, { status }),
  handleError: (error) => Response.json({ error: error.message }, { status: error.status || 500 }),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/services/fuel-settings.service", () => ({ getFuelPolicy: vi.fn(async () => ({})) }));
vi.mock("@/lib/fuel/receipt-storage", () => ({
  isOwnedFuelImageUrl: vi.fn(() => true),
  toStoredReceiptRef: vi.fn((value) => value),
  signFuelReceipt: vi.fn(async (row) => row),
  signFuelReceiptList: vi.fn(async (rows) => rows),
}));

const { GET, POST, DELETE } = await import("./route");
const { parseBody } = await import("@/lib/api/utils");
const { writeAudit } = await import("@/lib/audit");

describe("GET /api/fuel/requests receipt state", () => {
  beforeEach(() => {
    state.query.mockReset();
    state.query
      .mockResolvedValueOnce({
        rows: [{
          fuel_request_id: 58,
          status: "Fulfilled",
          active_receipt_count: 0,
          archived_receipt_count: 1,
          active_receipt_statuses: [],
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ pending: 0, approved: 0, rejected: 0, fulfilled: 1 }],
      });
  });

  it("returns active and archived receipt metadata with each permit", async () => {
    const response = await GET(new Request("https://fleet.test/api/fuel/requests"));
    const body = await response.json();
    const requestSql = state.query.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(requestSql).toContain("LEFT JOIN LATERAL");
    expect(requestSql).toContain("AS active_receipt_count");
    expect(requestSql).toContain("AS archived_receipt_count");
    expect(requestSql).toContain("AS active_receipt_statuses");
    expect(body.rows[0]).toMatchObject({
      status: "Fulfilled",
      active_receipt_count: 0,
      archived_receipt_count: 1,
      active_receipt_statuses: [],
    });
  });
});

describe("POST /api/fuel/requests open-request conflict", () => {
  const openRow = (over = {}) => ({
    fuel_request_id: 77,
    status: "Pending",
    trip_id: 55,
    age_days: 3,
    created_at: "2026-10-15T02:00:00+08:00",
    trip_status: "Dispatched",
    trip_deleted_at: null,
    linked_receipt_count: 0,
    ...over,
  });

  const postBody = () => ({
    current_fuel_level_percent: 5,
    client_submission_id: "submission-0001-abcdefgh",
    gauge_photo_url: "fuel/gauge/driver-11/photo.jpg",
    purpose: "Field visit",
  });

  const dispatchPostQueries = () => {
    state.query.mockImplementation(async (sql) => {
      if (sql.includes("INSERT INTO fuelrequests")) {
        if (state.insertFails > 0) {
          state.insertFails -= 1;
          const error = new Error("duplicate key value violates unique constraint");
          error.code = "23505";
          throw error;
        }
        return { rows: [{ fuel_request_id: state.updateRequest?.fuel_request_id ?? 101, status: "Approved" }] };
      }
      if (sql.includes("UPDATE vehicles")) return { rows: [] };
      // Auto-close of a stale open request (trip cancelled before review).
      if (sql.includes("SET status = 'Cancelled'")) {
        state.closeCount += 1;
        const closed = { fuel_request_id: state.blocking?.fuel_request_id ?? 77 };
        state.blocking = state.updateRequest;
        return { rows: [closed] };
      }
      if (sql.includes("client_submission_id")) return { rows: [] };
      if (sql.includes("driver_vehicle_assignments")) {
        return { rows: [state.vehicleRow ?? { trip_id: null, vehicle_id: 3, tank_capacity_l: "80", fuel_efficiency_kmpl: "9" }] };
      }
      // Level 3 measured-efficiency aggregates (verified receipts, completed
      // trip distance over the trailing window). No fixtures means no rows,
      // so measured stays ineligible and the request behaves as before.
      if (sql.includes("ANY($1::int[]")) {
        if (sql.includes("FROM fuelrecords")) return { rows: state.measuredReceipts ?? [] };
        return { rows: state.measuredDistance ?? [] };
      }
      if (sql.includes("LEFT JOIN dispatchschedules")) return { rows: [] };
      if (sql.includes("FROM fuelallocations")) {
        return { rows: [{ allocation_id: 1, allocated_liters: "1000.00", consumed_liters: "0", committed_liters: "0", remaining_liters: 1000 }] };
      }
      if (sql.includes("current_fuel_level_percent IS NOT NULL")) return { rows: [] };
      if (sql.includes("LEFT JOIN trips t ON t.trip_id = r.trip_id")) {
        return { rows: state.blocking ? [state.blocking] : [] };
      }
      throw new Error(`Unhandled SQL in test: ${sql}`);
    });
  };

  const post = () => POST(new Request("https://fleet.test/api/fuel/requests", {
    method: "POST",
    body: JSON.stringify(postBody()),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    state.blocking = null;
    state.insertFails = 0;
    state.closeCount = 0;
    state.updateRequest = null;
    state.measuredReceipts = null;
    state.measuredDistance = null;
    state.vehicleRow = { trip_id: null, vehicle_id: 3, tank_capacity_l: "80", fuel_efficiency_kmpl: "9" };
    vi.mocked(parseBody).mockImplementation(async (req) => JSON.parse(await req.text()));
    dispatchPostQueries();
  });

  it("names the blocking request and its age in the 409", async () => {
    state.blocking = openRow({ age_days: 3 });
    state.insertFails = 1;

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("OPEN_REQUEST_EXISTS");
    expect(body.error).toContain("open fuel request");
    expect(body.error).toContain("#77");
    expect(body.error).toContain("3 days ago");
    expect(body.blocking_request).toMatchObject({ fuel_request_id: 77, status: "Pending", age_days: 3 });
    expect(state.closeCount).toBe(0);
  });

  it("closes an open request whose trip was cancelled, then retries once", async () => {
    state.blocking = openRow({ trip_status: "Cancelled" });
    state.insertFails = 1;
    // After the close succeeds the vehicle is free: the retry insert lands.
    state.updateRequest = null;

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.fuel_request_id).toBe(101);
    expect(state.closeCount).toBe(1);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "auto-close", resource: "fuelrequests", resourceId: 77 })
    );
  });

  it("closes an open request whose trip already completed, naming the trip end", async () => {
    state.blocking = openRow({ trip_status: "Completed" });
    state.insertFails = 1;

    const response = await post();

    expect(response.status).toBe(201);
    expect(state.closeCount).toBe(1);
    const closeCall = state.query.mock.calls.find(([sql]) => sql.includes("SET status = 'Cancelled'"));
    expect(closeCall[1][1]).toContain("completed before the request was reviewed");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: "auto-close",
        resource: "fuelrequests",
        resourceId: 77,
        newValues: expect.objectContaining({ reason: "trip-completed" }),
      })
    );
  });

  it("leaves a permit with a linked receipt alone and reports it as the blocker", async () => {
    state.blocking = openRow({ trip_status: "Completed", linked_receipt_count: 1 });
    state.insertFails = 1;

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.blocking_request).toMatchObject({ fuel_request_id: 77, status: "Pending" });
    expect(state.closeCount).toBe(0);
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "auto-close" })
    );
  });

  it("forecasts from the vehicle's measured efficiency and records the basis", async () => {
    state.measuredReceipts = [{ vehicle_id: 3, liters: "20", receipts: 4 }];
    state.measuredDistance = [{ vehicle_id: 3, km: "150" }];

    const response = await post();

    expect(response.status).toBe(201);
    const insertCall = state.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO fuelrequests"));
    const snapshot = JSON.parse(insertCall[1][7]);
    expect(snapshot.efficiency_basis).toBe("measured");
    expect(snapshot.efficiency_kmpl).toBe(7.5);
    expect(snapshot.efficiency_measured).toEqual({ distance_km: 150, liters: 20, receipts: 4, window_days: 90 });
    expect(snapshot.efficiency_flags).toEqual([]);
  });

  it("flags a measured basis that disagrees wildly with the profile", async () => {
    state.measuredReceipts = [{ vehicle_id: 3, liters: "30", receipts: 4 }];
    state.measuredDistance = [{ vehicle_id: 3, km: "150" }];

    const response = await post();

    expect(response.status).toBe(201);
    const insertCall = state.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO fuelrequests"));
    const snapshot = JSON.parse(insertCall[1][7]);
    expect(snapshot.efficiency_kmpl).toBe(5);
    expect(snapshot.efficiency_flags).toEqual(["profile-gap-high"]);
  });

  it("keeps the profile basis when the measured gates do not pass", async () => {
    state.measuredReceipts = [{ vehicle_id: 3, liters: "20", receipts: 1 }];
    state.measuredDistance = [{ vehicle_id: 3, km: "150" }];

    const response = await post();

    expect(response.status).toBe(201);
    const insertCall = state.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO fuelrequests"));
    const snapshot = JSON.parse(insertCall[1][7]);
    expect(snapshot.efficiency_basis).toBe("profile");
    expect(snapshot.efficiency_kmpl).toBe(9);
    expect(snapshot.efficiency_measured).toBeUndefined();
  });

  it("lets measured receipts stand in for a missing profile when the gates pass", async () => {
    state.vehicleRow = { trip_id: null, vehicle_id: 3, tank_capacity_l: "80" };
    state.measuredReceipts = [{ vehicle_id: 3, liters: "20", receipts: 4 }];
    state.measuredDistance = [{ vehicle_id: 3, km: "150" }];

    const response = await post();

    expect(response.status).toBe(201);
    const insertCall = state.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO fuelrequests"));
    const snapshot = JSON.parse(insertCall[1][7]);
    expect(snapshot.efficiency_basis).toBe("measured");
  });

  it("returns 409 again when another request wins the race after the close", async () => {
    state.blocking = openRow({ trip_status: "Cancelled" });
    state.insertFails = 2;
    state.updateRequest = openRow({ fuel_request_id: 88, status: "Approved", trip_status: "Dispatched", age_days: 0 });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.blocking_request).toMatchObject({ fuel_request_id: 88, status: "Approved" });
    expect(state.closeCount).toBe(1);
  });

  it("does not auto-close requests whose trip is still active", async () => {
    state.blocking = openRow({ trip_status: "Dispatched" });
    state.insertFails = 1;

    const response = await post();

    expect(response.status).toBe(409);
    expect(state.closeCount).toBe(0);
  });
});

describe("DELETE /api/fuel/requests withdraw", () => {
  const withdrawRow = (over = {}) => ({
    fuel_request_id: 58,
    driver_id: 11,
    status: "Pending",
    linked_receipt_count: 0,
    ...over,
  });

  const request = (body) => DELETE(new Request("https://fleet.test/api/fuel/requests", {
    method: "DELETE",
    body: JSON.stringify(body),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    state.closeCount = 0;
    vi.mocked(parseBody).mockImplementation(async (req) => JSON.parse(await req.text()));
    state.txQuery.mockReset();
  });

  it("withdraws the driver's own pending request and releases the vehicle", async () => {
    state.txQuery
      .mockResolvedValueOnce({ rows: [withdrawRow()] })
      .mockResolvedValueOnce({ rows: [withdrawRow({ status: "Cancelled", review_notes: "Withdrawn by the driver" })] });

    const response = await request({ fuel_request_id: 58 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("Cancelled");
    const updateSql = state.txQuery.mock.calls[1][0];
    expect(updateSql).toContain("SET status = 'Cancelled'");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "withdraw", resource: "fuelrequests", resourceId: 58 })
    );
  });

  it("allows withdrawing an approved permit that was never fulfilled", async () => {
    state.txQuery
      .mockResolvedValueOnce({ rows: [withdrawRow({ status: "Approved" })] })
      .mockResolvedValueOnce({ rows: [withdrawRow({ status: "Cancelled" })] });

    const response = await request({ fuel_request_id: 58, reason: "No longer needed" });

    expect(response.status).toBe(200);
    expect(state.txQuery.mock.calls[1][1][1]).toBe("No longer needed");
  });

  it("refuses to withdraw a request that is no longer open", async () => {
    state.txQuery.mockResolvedValueOnce({ rows: [withdrawRow({ status: "Fulfilled" })] });

    const response = await request({ fuel_request_id: 58 });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/still open/i);
    expect(state.txQuery).toHaveBeenCalledTimes(1);
  });

  it("refuses to withdraw when a fuel receipt is already linked", async () => {
    state.txQuery.mockResolvedValueOnce({ rows: [withdrawRow({ status: "Approved", linked_receipt_count: 1 })] });

    const response = await request({ fuel_request_id: 58 });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/receipt/i);
    expect(state.txQuery).toHaveBeenCalledTimes(1);
  });

  it("404s when the request is not the driver's own", async () => {
    state.txQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request({ fuel_request_id: 999 });

    expect(response.status).toBe(404);
  });
});
