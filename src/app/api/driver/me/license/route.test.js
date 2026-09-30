import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requireDriver: vi.fn(),
  writeAuditRequired: vi.fn(),
  writeAuditBatchRequired: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => ({
  ...(await vi.importActual("@/lib/api/utils")),
  requireDriver: mocks.requireDriver,
}));
vi.mock("@/lib/audit", () => ({
  writeAuditRequired: mocks.writeAuditRequired,
  writeAuditBatchRequired: mocks.writeAuditBatchRequired,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));

import { GET, POST } from "./route";

const session = { user: { employeeId: 7, driverId: 13, role: "driver" } };
const eventKey = "be4ad8bb-260b-4b73-994a-ccbc884606d4";
const observedAt = new Date().toISOString();
const tx = { query: vi.fn().mockResolvedValue({ rows: [{ driver_id: 13, license_number: "N04-19-013583" }] }) };

function replayRequest(events) {
  return new Request("http://localhost/api/driver/me/license", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  });
}

describe("/api/driver/me/license", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.query.mockResolvedValue({ rows: [{ driver_id: 13, license_number: "N04-19-013583" }] });
    mocks.requireDriver.mockResolvedValue(session);
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.withTransaction.mockImplementation((callback) => callback(tx));
    mocks.writeAuditRequired.mockResolvedValue({ log_id: 1 });
    mocks.writeAuditBatchRequired.mockResolvedValue({ inserted: 1 });
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("requires an audit event before returning the driver's masked number", async () => {
    const response = await GET(new Request(`http://localhost/api/driver/me/license?event_key=${eventKey}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ license: { driver_id: 13, license_number: "********3583" } });
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(expect.anything(), expect.anything(), session, expect.objectContaining({
      action: "license_masked_viewed",
      resourceId: 13,
      eventKey,
      newValues: { driver_ids: [13], source: "self_license_screen", count: 1 },
    }));
  });

  it("fails closed when the masked-view audit cannot be stored", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await GET(new Request(`http://localhost/api/driver/me/license?event_key=${eventKey}`));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("********3583");
  });

  it("records bounded offline screen opens in one batch", async () => {
    const response = await POST(replayRequest([{ event_key: eventKey, driver_id: 13, observed_at: observedAt }]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 1, duplicates: 0 });
    expect(mocks.writeAuditBatchRequired).toHaveBeenCalledWith(expect.anything(), expect.anything(), session, [expect.objectContaining({
      action: "license_masked_viewed",
      eventKey,
      resourceId: 13,
      newValues: { driver_ids: [13], source: "client_offline", observed_at: observedAt, count: 1 },
    })]);
  });

  it("rejects reuse of an event key with a different observed time", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{
      event_key: eventKey,
      employee_id: 7,
      action: "license_masked_viewed",
      resource: "drivers",
      resource_id: 13,
      new_values: { driver_ids: [13], source: "client_offline", observed_at: "2026-09-30T00:00:00.000Z", count: 1 },
    }] });

    const response = await POST(replayRequest([{ event_key: eventKey, driver_id: 13, observed_at: observedAt }]));

    expect(response.status).toBe(409);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
});
