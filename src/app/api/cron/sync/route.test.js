// Pass 2 test: pruning can never fail the scheduled sync.
// Even when pruneAppErrors rejects, runSync still returns the
// vehicle/driver/compliance results with errors_pruned: 0.
// Same isolation is pinned for the trip start-window notification step
// (2026-09-09): a start-window failure never fails the sync, and its
// observability counters are surfaced on the response.
import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";
import * as serviceAuth from "@/lib/api/service-auth";
import * as statusService from "@/services/status.service";
import * as startWindowService from "@/services/start-window-notifications.service";
import * as appErrors from "@/lib/app-errors";
import * as systemHealth from "@/lib/system-health";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mockReq() {
  return { url: "http://x/api/cron/sync", headers: { get: () => null } };
}

function mockHappyPath(overrides = {}) {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.spyOn(serviceAuth, "verifyServiceToken").mockReturnValue({ ok: true });
  vi.spyOn(statusService, "syncAllVehicleStatuses").mockResolvedValue({ synced: 3 });
  vi.spyOn(statusService, "syncAllDriverStatuses").mockResolvedValue({ synced: 5 });
  vi.spyOn(statusService, "syncComplianceNotifications").mockResolvedValue({ created: 1 });
  vi.spyOn(appErrors, "pruneAppErrors").mockResolvedValue({ deleted: 0 });
  vi.spyOn(systemHealth, "recordSyncHeartbeat").mockResolvedValue(true);
  vi.spyOn(startWindowService, "syncStartWindowNotifications").mockResolvedValue({
    created: 0, pushes_attempted: 0, skipped: 0, errors: 0,
  });
  for (const [mod, name, impl] of overrides.mocks || []) {
    vi.spyOn(mod, name).mockImplementation(impl);
  }
}

describe("POST /api/cron/sync prune isolation", () => {
  it("returns sync results with errors_pruned: 0 when pruning throws", async () => {
    mockHappyPath({
      mocks: [[appErrors, "pruneAppErrors", vi.fn(async () => { throw new Error("prune exploded"); })]],
    });

    const res = await POST(mockReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drivers_synced).toBe(5);
    expect(body.notifications_created).toBe(1);
    expect(body.errors_pruned).toBe(0);
    expect(body.heartbeat_recorded).toBe(true);
  });

  it("pruning can never fail the sync, and heartbeat failure is tolerated", async () => {
    mockHappyPath({
      mocks: [
        [appErrors, "pruneAppErrors", vi.fn(async () => { throw new Error("prune exploded"); })],
        [systemHealth, "recordSyncHeartbeat", vi.fn(async () => false)],
      ],
    });

    const res = await POST(mockReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drivers_synced).toBe(5);
    expect(body.errors_pruned).toBe(0);
    expect(body.heartbeat_recorded).toBe(false);
  });

  it("reports the pruned count when pruning succeeds", async () => {
    mockHappyPath({
      mocks: [
        [statusService, "syncAllVehicleStatuses", vi.fn(async () => ({ synced: 0 }))],
        [statusService, "syncAllDriverStatuses", vi.fn(async () => ({ synced: 0 }))],
        [statusService, "syncComplianceNotifications", vi.fn(async () => ({ created: 0 }))],
        [appErrors, "pruneAppErrors", vi.fn(async () => ({ deleted: 4 }))],
      ],
    });

    const res = await POST(mockReq());
    expect(res.status).toBe(200);
    expect((await res.json()).errors_pruned).toBe(4);
  });
});

describe("POST /api/cron/sync start-window step", () => {
  it("surfaces the start-window observability counters", async () => {
    mockHappyPath();
    vi.spyOn(startWindowService, "syncStartWindowNotifications").mockResolvedValue({
      created: 3, pushes_attempted: 2, skipped: 1, errors: 0, stale_locations: 2,
    });

    const res = await POST(mockReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.start_window_notifications_created).toBe(3);
    expect(body.start_window_pushes_attempted).toBe(2);
    expect(body.start_window_skipped).toBe(1);
    expect(body.start_window_stale_locations).toBe(2);
    // The other steps are unaffected.
    expect(body.drivers_synced).toBe(5);
    expect(body.heartbeat_recorded).toBe(true);
  });

  it("a start-window rejection never fails the sync (isolation, like pruning)", async () => {
    mockHappyPath();
    vi.spyOn(startWindowService, "syncStartWindowNotifications").mockRejectedValue(new Error("scan exploded"));

    const res = await POST(mockReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.start_window_notifications_created).toBe(0);
    expect(body.start_window_stale_locations).toBe(0);
    expect(body.drivers_synced).toBe(5);
    expect(body.notifications_created).toBe(1);
    expect(body.heartbeat_recorded).toBe(true);
  });
});
