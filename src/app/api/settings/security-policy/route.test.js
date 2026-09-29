// Super Admin only, partial edits validated against the stored policy.
//
// The two things this pins are the ones that are invisible from the UI: that a
// partial save cannot silently reset the fields it did not send, and that the
// cross-field rule (absolute lifetime must outlive the idle window) surfaces as
// a 400 rather than being repaired behind the admin's back.
import { it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(async () => ({ user: { employeeId: 1 } })),
  parseBody: async (req) => req.body,
  ok: (data) => ({ status: 200, data }),
  err: (error, status) => ({ error, status }),
  handleError: (e) => {
    throw e;
  },
}));
vi.mock("@/services/security-policy.service", () => ({
  getSecurityPolicy: vi.fn(),
  saveSecurityPolicy: vi.fn(async (p) => p),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
import { requirePermission } from "@/lib/api/utils";
import { getSecurityPolicy, saveSecurityPolicy } from "@/services/security-policy.service";
import { DEFAULT_SECURITY_POLICY } from "@/lib/security-policy";
import { GET, PUT } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  getSecurityPolicy.mockResolvedValue({ ...DEFAULT_SECURITY_POLICY });
  // Mirrors the real service: layer the edit over the stored policy, so a
  // partial save keeps every field it did not mention.
  saveSecurityPolicy.mockImplementation(async (policy) => ({
    ...(await getSecurityPolicy()),
    ...policy,
  }));
});

it("reads the stored policy, gated on system.read", async () => {
  const res = await GET({});

  expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "system", "read");
  expect(res.status).toBe(200);
  expect(res.data).toEqual(DEFAULT_SECURITY_POLICY);
});

it("preserves saved values a partial edit never mentioned", async () => {
  getSecurityPolicy.mockResolvedValue({
    ...DEFAULT_SECURITY_POLICY,
    lockoutLimit: 20,
    tempPasswordTtlDays: 3,
  });

  const res = await PUT({ body: { idleTimeoutSeconds: 900 } });

  expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "system", "update");
  expect(res.status).toBe(200);
  expect(res.data).toMatchObject({
    idleTimeoutSeconds: 900,
    lockoutLimit: 20,
    tempPasswordTtlDays: 3,
  });
  expect(saveSecurityPolicy).toHaveBeenCalledWith({ idleTimeoutSeconds: 900 }, 1);
});

it("drops keys the server does not know rather than storing them", async () => {
  await PUT({ body: { idleTimeoutSeconds: 600, role: "admin", isAdmin: true } });

  expect(saveSecurityPolicy).toHaveBeenCalledWith({ idleTimeoutSeconds: 600 }, 1);
});

it("rejects a value outside the configured range without saving", async () => {
  const res = await PUT({ body: { lockoutLimit: 500 } });

  expect(res.status).toBe(400);
  expect(res.error).toContain("lockoutLimit");
  expect(saveSecurityPolicy).not.toHaveBeenCalled();
});

it("rejects an absolute lifetime that does not outlive the idle window", async () => {
  const res = await PUT({ body: { idleTimeoutSeconds: 3600, absoluteTtlSeconds: 1800 } });

  expect(res.status).toBe(400);
  expect(saveSecurityPolicy).not.toHaveBeenCalled();
});

it("accepts the same two fields when the ordering is legal", async () => {
  const res = await PUT({ body: { idleTimeoutSeconds: 1200, absoluteTtlSeconds: 7200 } });

  expect(res.status).toBe(200);
  expect(res.data).toMatchObject({ idleTimeoutSeconds: 1200, absoluteTtlSeconds: 7200 });
});
