import { expect, it, vi } from "vitest";
const ingestRequest = vi.fn(async (request) => ({ idempotent: false, request }));
vi.mock("@/lib/integration/ingest", () => ({ ingestRequest: (...args) => ingestRequest(...args) }));
vi.mock("@/lib/api/utils", () => ({ requirePermission: vi.fn(async () => ({ user: { id: 1 } })), ok: (value) => Response.json(value), handleError: (e) => Response.json({ error: e.message }, { status: 500 }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/integration/booking-gateway", () => ({ getBookingGateway: () => ({ name: "mock", fetchPendingRequests: async () => [
  { contract_version: 2, external_request_id: "pos-cargo", external_revision: 1, event_id: "evt-1", event_kind: "create", source_system: "POS", request: { pickup_location: "Restaurant", pickup_datetime: "2026-10-05T10:00:00+08:00", pickup_location_code: "74dd0286-7124-4123-ae99-6896c82348cb", pickup_location_proposal: { address: "Restaurant service door" }, service_code: "RESTAURANT_SUPPLY_PICKUP", load_type: "Cargo", cargo_weight_kg: 650, cargo_description: "Produce" } },
  { contract_version: 2, external_request_id: "pms-passenger", external_revision: 1, event_id: "evt-2", event_kind: "create", source_system: "PMS", request: { pickup_location: "Hotel", pickup_datetime: "2026-10-05T11:00:00+08:00", service_code: "GUEST_TRANSPORT", load_type: "Passenger", passenger_count: 4 } },
] }) }));
import { POST } from "./route";

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
  ingestRequest.mockReset();
  ingestRequest.mockImplementation(async (request) => ({ idempotent: false, request }));
  ingestRequest.mockClear();
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
