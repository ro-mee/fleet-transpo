import { afterEach, expect, it, vi } from "vitest";
import { DELETE } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import * as audit from "@/lib/audit";

afterEach(() => vi.restoreAllMocks());

it("releases custody on the Philippine day and returns calendar keys", async () => {
  vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });
  vi.spyOn(utils, "parseBody").mockResolvedValue({});
  vi.spyOn(audit, "writeAudit").mockResolvedValue();
  const query = vi.spyOn(db, "query").mockImplementation(async (sql) => ({ rows: sql.includes("UPDATE")
    ? [{ assignment_id: 1, assigned_from: new Date(2026, 9, 25), assigned_until: new Date(2026, 9, 26) }]
    : [{ assignment_id: 1, driver_id: 7, vehicle_id: 9, assigned_until: null }] }));
  const response = await DELETE({}, { params: Promise.resolve({ id: "1" }) });
  const { assignment } = await response.json();
  expect(response.status).toBe(200);
  expect(assignment).toMatchObject({ assigned_from: "2026-10-25", assigned_until: "2026-10-26" });
  expect(query.mock.calls.find(([sql]) => sql.includes("UPDATE"))?.[0]).toContain("AT TIME ZONE 'Asia/Manila'");
});
