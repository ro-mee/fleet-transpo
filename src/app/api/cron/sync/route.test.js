// Pass 2 test: pruning can never fail the scheduled sync.
// Even when pruneAppErrors rejects, runSync still returns the
// vehicle/driver/compliance results with errors_pruned: 0.
import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";
import * as serviceAuth from "@/lib/api/service-auth";
import * as statusService from "@/services/status.service";
import * as appErrors from "@/lib/app-errors";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mockReq() {
  return { url: "http://x/api/cron/sync", headers: { get: () => null } };
}

describe("POST /api/cron/sync prune isolation", () => {
  it("returns sync results with errors_pruned: 0 when pruning throws", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.spyOn(serviceAuth, "verifyServiceToken").mockReturnValue({ ok: true });
    vi.spyOn(statusService, "syncAllVehicleStatuses").mockResolvedValue({ synced: 3 });
    vi.spyOn(statusService, "syncAllDriverStatuses").mockResolvedValue({ synced: 5 });
    vi.spyOn(statusService, "syncComplianceNotifications").mockResolvedValue({ created: 1 });
    vi.spyOn(appErrors, "pruneAppErrors").mockRejectedValue(new Error("prune exploded"));

    const res = await POST(mockReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drivers_synced).toBe(5);
    expect(body.notifications_created).toBe(1);
    expect(body.errors_pruned).toBe(0);
  });

  it("reports the pruned count when pruning succeeds", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.spyOn(serviceAuth, "verifyServiceToken").mockReturnValue({ ok: true });
    vi.spyOn(statusService, "syncAllVehicleStatuses").mockResolvedValue({ synced: 0 });
    vi.spyOn(statusService, "syncAllDriverStatuses").mockResolvedValue({ synced: 0 });
    vi.spyOn(statusService, "syncComplianceNotifications").mockResolvedValue({ created: 0 });
    vi.spyOn(appErrors, "pruneAppErrors").mockResolvedValue({ deleted: 4 });

    const res = await POST(mockReq());
    expect(res.status).toBe(200);
    expect((await res.json()).errors_pruned).toBe(4);
  });
});
