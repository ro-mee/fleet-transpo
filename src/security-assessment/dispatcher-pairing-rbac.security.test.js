import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import * as apiUtils from "@/lib/api/utils";
import * as audit from "@/lib/audit";
import * as db from "@/lib/db";
import { DELETE as deleteAssignment } from "@/app/api/driver-assignments/[id]/route";
import { POST as createAssignment } from "@/app/api/driver-assignments/route";
import { PATCH as updateSubstitute } from "@/app/api/substitute-driver-schedules/[id]/route";
import {
  DELETE as deleteSubstitute,
} from "@/app/api/substitute-driver-schedules/[id]/route";
import { POST as createSubstitute } from "@/app/api/substitute-driver-schedules/route";

const PAIRING_MUTATIONS = [
  ["POST driver pairing", () => createAssignment(request("/api/driver-assignments", "POST"))],
  ["DELETE driver pairing", () => deleteAssignment(
    request("/api/driver-assignments/71", "DELETE"),
    { params: Promise.resolve({ id: "71" }) }
  )],
  ["POST substitute schedule", () => createSubstitute(request("/api/substitute-driver-schedules", "POST"))],
  ["PATCH substitute schedule", () => updateSubstitute(
    request("/api/substitute-driver-schedules/44", "PATCH"),
    { params: Promise.resolve({ id: "44" }) }
  )],
  ["DELETE substitute schedule", () => deleteSubstitute(
    request("/api/substitute-driver-schedules/44", "DELETE"),
    { params: Promise.resolve({ id: "44" }) }
  )],
];

const PERMISSION_ACTIONS = [
  ["driver_assignments", "create"],
  ["driver_assignments", "delete"],
  ["substitute_driver_schedules", "create"],
  ["substitute_driver_schedules", "update"],
  ["substitute_driver_schedules", "delete"],
];

function request(path, method) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__HARNESS_SESSION__ = true;
  auth.mockResolvedValue({ user: { employeeId: 48, role: "dispatcher" } });
  vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
  vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => fn({ query: vi.fn() }));
  vi.spyOn(audit, "writeAudit").mockResolvedValue();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete globalThis.__HARNESS_SESSION__;
  vi.restoreAllMocks();
});

describe("Dispatcher pairing and substitute-schedule write boundary", () => {
  it.each(PAIRING_MUTATIONS)("returns 403 before side effects for %s", async (_label, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Role 'dispatcher' is not permitted" });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.withTransaction).not.toHaveBeenCalled();
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it.each(PERMISSION_ACTIONS)("retains Fleet Manager access to %s:%s", async (resource, action) => {
    auth.mockResolvedValue({ user: { employeeId: 48, role: "fleet_manager" } });

    await expect(apiUtils.requirePermission(request("/api/permission-check", "POST"), resource, action))
      .resolves.toMatchObject({ user: { role: "fleet_manager" } });
  });
});
