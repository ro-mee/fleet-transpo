import { beforeEach, expect, it, vi } from "vitest";
const ingestRequest = vi.fn(async (request) => ({ idempotent: false, request }));
const { getGateway } = vi.hoisted(() => ({ getGateway: vi.fn() }));
vi.mock("@/lib/integration/ingest", () => ({ ingestRequest: (...args) => ingestRequest(...args) }));
vi.mock("@/lib/api/utils", () => ({ requirePermission: vi.fn(async () => ({ user: { id: 1 } })), ok: (value) => Response.json(value), handleError: (e) => Response.json({ error: e.message }, { status: 500 }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/integration/booking-gateway", () => ({ getBookingGateway: () => getGateway() }));
import { POST } from "./route";

const MOCK_INCOMING = [
  { contract_version: 2, external_request_id: "pos-cargo", external_revision: 1, event_id: "evt-1", event_kind: "create", source_system: "POS", request: { pickup_location: "Restaurant", pickup_datetime: "2026-10-05T10:00:00+08:00", pickup_location_code: "74dd0286-7124-4123-ae99-6896c82348cb", pickup_location_proposal: { address: "Restaurant service door" }, service_code: "RESTAURANT_SUPPLY_PICKUP", load_type: "Cargo", cargo_weight_kg: 650, cargo_description: "Produce" } },
  { contract_version: 2, external_request_id: "pms-passenger", external_revision: 1, event_id: "evt-2", event_kind: "create", source_system: "PMS", request: { pickup_location: "Hotel", pickup_datetime: "2026-10-05T11:00:00+08:00", service_code: "GUEST_TRANSPORT", load_type: "Passenger", passenger_count: 4 } },
];
const LEGACY_REQUEST = {
  external_booking_id: "legacy-request",
  source_system: "POS",
  pickup_location: "Hotel",
  pickup_datetime: "2026-10-05T11:00:00+08:00",
};

beforeEach(() => {
  ingestRequest.mockReset().mockImplementation(async (request) => ({ idempotent: false, request }));
  getGateway.mockReset().mockReturnValue({
    name: "mock",
    fetchPendingRequests: async () => MOCK_INCOMING,
  });
});

it.each(["SERVICE_UNAVAILABLE", "SOURCE_CREATE_CONFLICT", "SOURCE_ID_TOMBSTONED", "LOCATION_CODE_UNKNOWN", "LOCATION_CODE_RETIRED"])(
  "continues after a %s rejection and reports it without losing the next item",
  async (code) => {
    ingestRequest.mockReset();
    ingestRequest.mockRejectedValueOnce(Object.assign(new Error("Source item rejected"), { code }));
    ingestRequest.mockImplementation(async (request) => ({ idempotent: false, request }));
    const result = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ ingested: 1, rejected: 1, skipped: 1, rejectionCodes: { [code]: 1 } });
    expect(ingestRequest).toHaveBeenCalledTimes(2);
  }
);

it("does not mask database failures as harmless rejected items", async () => {
  ingestRequest.mockReset();
  ingestRequest.mockRejectedValueOnce(new Error("database unavailable"));
  const result = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));
  expect(result.status).toBe(500);
});

it("pulls trusted mock POS cargo and PMS passengers through shared ingest without phantom riders", async () => {
  const result = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));
  expect(result.status).toBe(200);
  expect((await result.json()).ingested).toBe(2);
  expect(ingestRequest.mock.calls[0][0]).toMatchObject({
    source_system: "POS",
    external_booking_id: "pos-cargo",
    passenger_count: null,
    cargo_weight_kg: 650,
    pickup_location_code: "74dd0286-7124-4123-ae99-6896c82348cb",
    pickup_location_proposal: { address: "Restaurant service door" },
  });
  expect(ingestRequest.mock.calls[0][1]).toMatchObject({ strictReplay: true });
  expect(ingestRequest.mock.calls[1][0]).toMatchObject({ source_system: "PMS", passenger_count: 4 });
});

it("binds a non-mock legacy row to the trusted adapter source, not its claimed source", async () => {
  getGateway.mockReturnValue({
    name: "http",
    sourceIdentity: "PMS",
    fetchPendingRequests: async () => [LEGACY_REQUEST],
  });

  const response = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));

  expect(response.status).toBe(200);
  expect(ingestRequest).toHaveBeenCalledTimes(1);
  expect(ingestRequest.mock.calls[0][0].source_system).toBe("PMS");
});

it("binds a non-mock v2 envelope to the trusted adapter source", async () => {
  getGateway.mockReturnValue({
    name: "http",
    sourceIdentity: "PMS",
    fetchPendingRequests: async () => [{ ...MOCK_INCOMING[0], source_system: "POS" }],
  });

  const response = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));

  expect(response.status).toBe(200);
  expect(ingestRequest).toHaveBeenCalledTimes(1);
  expect(ingestRequest.mock.calls[0][0].source_system).toBe("PMS");
  expect(ingestRequest.mock.calls[0][1]).toMatchObject({ strictReplay: true });
});

it("skips non-mock rows when the adapter has no trusted source identity", async () => {
  getGateway.mockReturnValue({ name: "http", fetchPendingRequests: async () => [LEGACY_REQUEST] });

  const response = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));

  expect(response.status).toBe(200);
  expect((await response.json()).skipped).toBe(1);
  expect(ingestRequest).not.toHaveBeenCalled();
});

it("reports unsupported v2 revisions and continues through the batch", async () => {
  const unsupported = [
    { ...MOCK_INCOMING[0], event_kind: "update" },
    { ...MOCK_INCOMING[0], event_kind: "cancel" },
    { ...MOCK_INCOMING[0], external_revision: 2 },
  ];
  getGateway.mockReturnValue({
    name: "mock",
    fetchPendingRequests: async () => [...unsupported, MOCK_INCOMING[1]],
  });
  const response = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    ingested: 1,
    skipped: 3,
    rejected: 3,
    rejectionCodes: { SOURCE_REVISION_UNSUPPORTED: 3 },
  });
  expect(ingestRequest).toHaveBeenCalledTimes(1);
});

it("skips an invalid correction without ingesting it or losing the following create", async () => {
  getGateway.mockReturnValue({
    name: "mock",
    fetchPendingRequests: async () => [
      { ...MOCK_INCOMING[0], external_revision: 2, event_kind: "update", request: { ...MOCK_INCOMING[0].request, cargo_weight_kg: -1 } },
      MOCK_INCOMING[1],
    ],
  });
  const response = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ingested: 1, skipped: 1, rejected: 0, rejectionCodes: {} });
  expect(ingestRequest).toHaveBeenCalledTimes(1);
  expect(ingestRequest.mock.calls[0][0]).toMatchObject({ external_booking_id: "pms-passenger", source_system: "PMS" });
});
