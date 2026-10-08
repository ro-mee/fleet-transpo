import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(async () => ({ user: { employeeId: 42, role: "admin" } })),
  parseBody: async (req) => req.body,
  ok: (data) => ({ status: 200, data }),
  err: (error, status) => ({ error, status }),
  handleError: (e) => {
    throw e;
  },
}));

vi.mock("@/services/work-shift-policy.service", () => ({
  getWorkShiftPolicy: vi.fn(),
  saveWorkShiftPolicy: vi.fn(),
  applyWorkShiftPolicyToDrivers: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
}));

import { requirePermission } from "@/lib/api/utils";
import {
  getWorkShiftPolicy,
  saveWorkShiftPolicy,
  applyWorkShiftPolicyToDrivers,
} from "@/services/work-shift-policy.service";
import { writeAudit } from "@/lib/audit";
import { DEFAULT_WORK_SHIFT_POLICY } from "@/lib/work-shift-policy";
import { GET, PUT } from "./route";
import { POST as POST_APPLY } from "./apply/route";

describe("Work Shift Policy Settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkShiftPolicy.mockResolvedValue({ ...DEFAULT_WORK_SHIFT_POLICY });
    saveWorkShiftPolicy.mockImplementation(async (p) => ({
      ...DEFAULT_WORK_SHIFT_POLICY,
      ...p,
    }));
    applyWorkShiftPolicyToDrivers.mockResolvedValue({
      updatedCount: 8,
      driverIds: [1, 2, 3, 4, 5, 6, 7, 8],
      policy: DEFAULT_WORK_SHIFT_POLICY,
    });
  });

  describe("GET /api/settings/work-shift", () => {
    it("reads work shift policy, guarded by dispatch_settings.read", async () => {
      const res = await GET({});
      expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "dispatch_settings", "read");
      expect(res.status).toBe(200);
      expect(res.data).toEqual(DEFAULT_WORK_SHIFT_POLICY);
    });
  });

  describe("PUT /api/settings/work-shift", () => {
    it("updates policy when valid and writes audit", async () => {
      const payload = {
        shiftStart: "07:00",
        shiftEnd: "21:00",
        breakStart: "12:00",
        breakEnd: "13:00",
        workingDays: [1, 2, 3, 4, 5],
      };

      const res = await PUT({ body: payload });
      expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "dispatch_settings", "update");
      expect(res.status).toBe(200);
      expect(saveWorkShiftPolicy).toHaveBeenCalledWith(payload, 42);
      expect(writeAudit).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          action: "update",
          resource: "work_shift_policy",
        })
      );
    });

    it("rejects invalid time ranges with 400", async () => {
      const invalid = {
        shiftStart: "20:00",
        shiftEnd: "08:00",
      };

      const res = await PUT({ body: invalid });
      expect(res.status).toBe(400);
      expect(res.error).toContain("Shift end time must be after shift start time");
      expect(saveWorkShiftPolicy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/settings/work-shift/apply", () => {
    it("batch applies policy to drivers and logs audit", async () => {
      const res = await POST_APPLY({
        body: { driver_ids: [1, 2], stagger_breaks: true, stagger_rest_days: true },
      });
      expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "dispatch_settings", "update");
      expect(res.status).toBe(200);
      expect(applyWorkShiftPolicyToDrivers).toHaveBeenCalledWith({
        driverIds: [1, 2],
        staggerBreaks: true,
        staggerRestDays: true,
        actorId: 42,
      });
      expect(writeAudit).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          action: "apply",
          resource: "driver_work_schedules",
        })
      );
    });

    it("rejects an empty driver selection instead of applying to everyone", async () => {
      const res = await POST_APPLY({ body: { driver_ids: [] } });
      expect(res.status).toBe(400);
      expect(applyWorkShiftPolicyToDrivers).not.toHaveBeenCalled();
    });

    it("rejects malformed options instead of silently applying to everyone", async () => {
      const res = await POST_APPLY({ body: { stagger_breaks: "false" } });
      expect(res.status).toBe(400);
      expect(applyWorkShiftPolicyToDrivers).not.toHaveBeenCalled();
    });
  });
});
