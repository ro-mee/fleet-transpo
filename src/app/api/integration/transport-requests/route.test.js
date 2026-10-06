import { afterEach, describe, expect, it, vi } from "vitest";
const ingestRequest = vi.fn(async (request) => ({ idempotent: true, request }));
vi.mock("@/lib/integration/ingest", () => ({ ingestRequest: (...args) => ingestRequest(...args) }));
vi.mock("@/lib/api/utils", () => ({ requirePermission: vi.fn(), resolveIdentity: vi.fn(async () => null), ok: (value, status = 200) => Response.json(value, { status }), err: (message, status) => Response.json({ error: message }, { status }), handleError: (e) => Response.json({ error: e.message }, { status: 500 }) }));
const query = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args) => query(...args) }));
vi.mock("@/lib/scheduling/conflicts", () => ({ detectConflictsForRequests: vi.fn() }));
vi.mock("@/services/priority.service", () => ({ recomputeDerivedPriority: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
import { GET, POST } from "./route";

const payload = { external_booking_id: "123", source_system: "POS", pickup_location: "Lobby", pickup_datetime: "2026-10-05T10:00:00+08:00" };
const typedPayload = { ...payload, load_type: "Passenger", service_code: "GUEST_TRANSPORT", passenger_count: 4 };
const send = (body, token, url = "http://localhost/api/integration/transport-requests") => POST(new Request(url, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
afterEach(() => { vi.unstubAllEnvs(); ingestRequest.mockClear(); });

it("projects typed load and service codes on register and queue GET responses", async () => {
  const row = { request_id: 501, load_type: "Cargo", passenger_count: null, cargo_weight_kg: "650.000", cargo_description: "Vegetables", source_department: "Kitchen", service_code: "RESTAURANT_SUPPLY_PICKUP" };
  query.mockImplementation(async (sql) => ({ rows: sql.includes("count(") ? [{ total: 1, open: 1 }] : [row] }));
  for (const suffix of ["?page=1", "?tab=today"]) {
    query.mockClear();
    const res = await GET(new Request(`http://localhost/api/integration/transport-requests${suffix}`));
    expect(res.status).toBe(200);
    expect((await res.json()).rows[0]).toMatchObject(row);
    const sql = query.mock.calls[0][0];
    for (const name of ["tr.load_type", "tr.cargo_weight_kg", "tr.cargo_description", "tr.source_department", "st.service_code"]) expect(sql).toContain(name);
  }
});

describe("authenticated integration POST", () => {
  it("rejects unauthenticated POS claims even with a PMS token in query parameters", async () => {
    vi.stubEnv("BOOKING_WEBHOOK_SECRET", "pms-secret");
    const res = await send(payload, null, "http://localhost/api/integration/transport-requests?token=pms-secret");
    expect(res.status).toBe(401);
    expect(ingestRequest).not.toHaveBeenCalled();
  });
  it("fails closed when two configured sources share a credential", async () => {
    vi.stubEnv("BOOKING_WEBHOOK_SECRET", "shared-secret");
    vi.stubEnv("POS_WEBHOOK_SECRET", "shared-secret");
    const res = await send(payload, "shared-secret");
    expect(res.status).toBe(401);
    expect(ingestRequest).not.toHaveBeenCalled();
  });
  it("uses PMS adapter identity rather than forged raw source", async () => {
    vi.stubEnv("BOOKING_WEBHOOK_SECRET", "pms-secret");
    const res = await send(payload, "pms-secret");
    expect(res.status).toBe(200);
    expect(ingestRequest.mock.calls[0][0].source_system).toBe("PMS");
  });
  it("refuses an update or cancellation rather than mutating a dispatched request", async () => {
    vi.stubEnv("POS_WEBHOOK_SECRET", "pos-secret");
    for (const event_kind of ["update", "cancel"]) {
      const res = await send({ contract_version: 2, external_request_id: "123", external_revision: 2, event_id: `evt-${event_kind}`, event_kind, ...(event_kind === "update" ? { request: typedPayload } : {}) }, "pos-secret");
      expect(res.status).toBe(409);
    }
    const legacyUpdate = await send({ contract_version: 2, external_request_id: "123", external_revision: 2, event_id: "evt-old-shape", event_kind: "update", request: payload }, "pos-secret");
    expect(legacyUpdate.status).toBe(409);
    expect(ingestRequest).not.toHaveBeenCalled();
  });
  it("returns 409 when a source retries a deleted request ID", async () => {
    vi.stubEnv("BOOKING_WEBHOOK_SECRET", "pms-secret");
    ingestRequest.mockRejectedValueOnce(Object.assign(new Error("Tombstoned source ID"), { code: "SOURCE_ID_TOMBSTONED" }));
    const res = await send(payload, "pms-secret");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/deleted request/i);
  });
  it("returns the typed POS cargo payload with null riders and rejects unavailable catalog codes", async () => {
    vi.stubEnv("POS_WEBHOOK_SECRET", "pos-secret");
    const body = { contract_version: 2, external_request_id: "cargo-650", external_revision: 1, event_id: "evt-cargo", event_kind: "create", request: { ...payload, load_type: "Cargo", service_code: "RESTAURANT_SUPPLY_PICKUP", cargo_weight_kg: 650, cargo_description: "Produce" } };
    const accepted = await send(body, "pos-secret");
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ source_system: "POS", passenger_count: null, cargo_weight_kg: 650, service_code: "RESTAURANT_SUPPLY_PICKUP" });
    ingestRequest.mockRejectedValueOnce(Object.assign(new Error("inactive service"), { code: "SERVICE_UNAVAILABLE" }));
    const unavailable = await send({ ...body, external_request_id: "cargo-651" }, "pos-secret");
    expect(unavailable.status).toBe(422);
  });
  it("accepts POS v2 only with its own bearer credential", async () => {
    vi.stubEnv("POS_WEBHOOK_SECRET", "pos-secret");
    const res = await send({ contract_version: 2, source_system: "PMS", external_request_id: "123", external_revision: 1, event_id: "evt-1", event_kind: "create", request: typedPayload }, "pos-secret");
    expect(res.status).toBe(200);
    expect(ingestRequest.mock.calls[0][0].source_system).toBe("POS");
  });
});
