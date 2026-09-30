import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  getPool: vi.fn(() => ({ totalCount: 1, idleCount: 1, waitingCount: 0, options: { max: 10 } })),
}));
const rateLimit = vi.hoisted(() => ({ clientIp: vi.fn(() => "203.0.113.8") }));

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/rate-limit", () => rateLimit);

import { sanitizeAuditValues, writeAudit, writeAuditRequired } from "@/lib/audit";

describe("audit payload safety", () => {
  it("keeps concise event metadata and drops sensitive or free-text fields", () => {
    const result = JSON.parse(sanitizeAuditValues({
      driver_id: 12,
      status: "In Progress",
      changed_fields: ["phone", "license_number"],
      license_number: "********1234",
      email: "driver@example.com",
      notes: "private free text",
      provider_secret: "never-store",
    }));

    expect(result).toEqual({
      driver_id: 12,
      status: "In Progress",
      changed_fields: ["phone", "license_number"],
    });
  });

  it("rejects oversized safe metadata instead of storing a partial row", () => {
    expect(() => sanitizeAuditValues({ changed_fields: Array(25).fill("x".repeat(100)) }))
      .toThrow("1 KiB limit");
  });
});

describe("audit writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a transaction-scoped timeout and writes sanitized metadata", async () => {
    const tx = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ log_id: 9, action: "update", resource: "drivers" }] }) };
    const req = new Request("https://fleet.test/api/drivers/12", { headers: { "user-agent": "web" } });

    await writeAuditRequired(tx, req, { user: { employeeId: 4 } }, {
      action: "update",
      resource: "drivers",
      resourceId: 12,
      oldValues: { email: "private@example.com", driver_status: "Available" },
      newValues: { changed_fields: ["phone"], license_number: "********1234" },
    });

    expect(tx.query).toHaveBeenCalledTimes(2);
    expect(tx.query.mock.calls[0]).toEqual([
      "SELECT set_config('statement_timeout', $1, true)",
      ["1500ms"],
    ]);
    const [sql, params] = tx.query.mock.calls[1];
    expect(sql).toContain("event_key");
    expect(params).toEqual([
      4,
      "update",
      "drivers",
      12,
      JSON.stringify({ driver_status: "Available" }),
      JSON.stringify({ changed_fields: ["phone"] }),
      "203.0.113.8",
      "web",
      null,
    ]);
  });

  it("keeps the legacy writer best-effort and reports failures without throwing", async () => {
    const original = console.error;
    console.error = vi.fn();
    db.withTransaction.mockRejectedValueOnce(Object.assign(new Error("db unavailable"), { code: "08006" }));
    try {
      await expect(writeAudit(null, null, { action: "create", resource: "vehicles" })).resolves.toBeNull();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"event":"audit_write_failed"'));
    } finally {
      console.error = original;
    }
  });

  it("skips best-effort writes when the shared pool needs its reserved capacity", async () => {
    const original = console.warn;
    console.warn = vi.fn();
    db.getPool.mockReturnValueOnce({ totalCount: 10, idleCount: 2, waitingCount: 0, options: { max: 10 } });
    try {
      await expect(writeAudit(null, null, { action: "create", resource: "vehicles" })).resolves.toBeNull();
      expect(db.withTransaction).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"event":"audit_write_dropped_overload"'));
    } finally {
      console.warn = original;
    }
  });
});
