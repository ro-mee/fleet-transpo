import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args) => queryMock(...args),
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/smtp", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendTempPasswordEmail: vi.fn().mockResolvedValue({ messageId: "smtp-invite" }),
}));

const requirePermission = vi.fn();
vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requirePermission: (...args) => requirePermission(...args),
  };
});

import { POST } from "./route";
import { writeAudit } from "@/lib/audit";
import { isEmailConfigured, sendTempPasswordEmail } from "@/lib/email/smtp";
import { ROLE_IDS } from "@/lib/constants";

const ADMIN_SESSION = {
  user: { employeeId: 1, role: "super_admin", email: "admin@internal" },
};

const VALID = {
  email: "probe@gmail.com",
  first_name: "Probe",
  last_name: "Account",
  role_id: String(ROLE_IDS.dispatcher),
};

function post(body) {
  const req = new Request("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

function setQuery({ existing = [], insertId = 77 } = {}) {
  queryMock.mockImplementation(async (sql, params) => {
    if (sql.includes("SELECT employee_id FROM employees")) return { rows: existing };
    if (sql.includes("INSERT INTO employees")) return { rows: [{ employee_id: insertId }] };
    if (sql.includes("DELETE FROM employees")) return { rows: [] };
    return { rows: [] };
  });
}

function insertCall() {
  return queryMock.mock.calls.find(([sql]) => sql.includes("INSERT INTO employees"));
}

beforeEach(() => {
  vi.clearAllMocks();
  isEmailConfigured.mockReturnValue(true);
  sendTempPasswordEmail.mockResolvedValue({ messageId: "smtp-invite" });
  requirePermission.mockResolvedValue(ADMIN_SESSION);
  setQuery();
});

describe("POST /api/auth/register — temp-password invite flow", () => {
  it("creates the account with the invite flags and returns no password material", async () => {
    const res = await post(VALID);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.employee_id).toBe(77);
    expect(data.message).toMatch(/temporary password sent to probe@gmail\.com/);
    expect(Object.keys(data).sort()).toEqual(["employee_id", "message"]);
    expect(JSON.stringify(data)).not.toMatch(/\$2b\$/); // no hash leak
  });

  it("stores a bcrypt hash with must_change_password and a 7-day expiry", async () => {
    await post(VALID);

    const [sql, params] = insertCall();
    const [email, hash, firstName, lastName, roleId, expiresAt] = params;
    expect(sql).toMatch(/must_change_password,\s*temp_credential_expires_at/);
    expect(sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, true, \$6\)/);
    expect(email).toBe("probe@gmail.com");
    expect(hash).toMatch(/^\$2b\$/);
    expect(firstName).toBe("Probe");
    expect(lastName).toBe("Account");
    expect(roleId).toBe(ROLE_IDS.dispatcher);
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 5000);
  });

  it("audits the create without any credential in newValues", async () => {
    await post(VALID);

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][2];
    expect(entry.action).toBe("create");
    expect(entry.resource).toBe("employees");
    expect(entry.resourceId).toBe(77);
    expect(entry.newValues).not.toHaveProperty("password");
    expect(entry.newValues).not.toHaveProperty("password_hash");
    expect(entry.newValues.invited).toBe(true);
  });

  it("ignores a legacy password key in the payload", async () => {
    const res = await post({ ...VALID, password: "Legacy!Password1" });
    expect(res.status).toBe(201);
    expect(sendTempPasswordEmail).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the invite email cannot be sent: compensating DELETE + audit, 502", async () => {
    sendTempPasswordEmail.mockRejectedValueOnce(new Error("SMTP down"));

    const res = await post(VALID);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error).toMatch(/invitation email failed to send/);

    const deleteCall = queryMock.mock.calls.find(([sql]) => sql.includes("DELETE FROM employees"));
    expect(deleteCall).toBeTruthy();

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][2];
    expect(entry.action).toBe("invite_email_failed");
    expect(entry.newValues).not.toHaveProperty("password");
  });

  it("refuses an undeliverable address before any insert", async () => {
    const res = await post({ ...VALID, email: "probe@local.invalid" });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/cannot receive email/);
    expect(insertCall()).toBeUndefined();
    expect(sendTempPasswordEmail).not.toHaveBeenCalled();
  });

  it("refuses before any insert when SMTP is not configured", async () => {
    isEmailConfigured.mockReturnValue(false);

    const res = await post(VALID);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/Email delivery is not configured/);
    expect(insertCall()).toBeUndefined();
  });

  it("answers 409 for a duplicate email before the deliverability precheck", async () => {
    setQuery({ existing: [{ employee_id: 9 }] });

    const res = await post({ ...VALID, email: "probe@local.invalid" });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe("An account with this email already exists.");
    expect(insertCall()).toBeUndefined();
  });

  it("rejects invalid payloads with 400", async () => {
    const badEmail = await post({ ...VALID, email: "not-an-email" });
    expect(badEmail.status).toBe(400);

    const badRole = await post({ ...VALID, role_id: "9999" });
    expect(badRole.status).toBe(400);

    const digitName = await post({ ...VALID, first_name: "Probe2" });
    expect(digitName.status).toBe(400);

    const missingPasswordStillOkForValidation = await post({
      email: "probe@gmail.com",
      first_name: "Probe",
      last_name: "Account",
      role_id: String(ROLE_IDS.dispatcher),
    });
    // No password field exists anymore — this valid payload proceeds to insert.
    expect(missingPasswordStillOkForValidation.status).toBe(201);
    expect(insertCall()).toBeTruthy();
  });

  it("refuses role assignment the actor cannot grant (403)", async () => {
    requirePermission.mockResolvedValue({
      user: { employeeId: 2, role: "dispatcher", email: "dispatch@internal" },
    });

    const res = await post({ ...VALID, role_id: String(ROLE_IDS.super_admin) });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(typeof data.error).toBe("string");
    expect(insertCall()).toBeUndefined();
  });

  it("requires the accounts:create permission", async () => {
    requirePermission.mockRejectedValue(
      Object.assign(new Error("Role 'management' is not permitted"), { status: 403, code: undefined })
    );

    const res = await post(VALID);
    // handleError maps non-AuthError errors to 500; a plain Error here proves
    // requirePermission was consulted BEFORE any work happened.
    expect([403, 500]).toContain(res.status);
    expect(insertCall()).toBeUndefined();
    expect(sendTempPasswordEmail).not.toHaveBeenCalled();
  });
});
