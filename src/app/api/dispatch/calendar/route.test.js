import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";

describe("GET /api/dispatch/calendar core feeds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role: "admin" } });
  });

  const request = () => new Request("http://localhost/api/dispatch/calendar?from=2026-10-01T16%3A00%3A00.000Z&to=2026-10-02T15%3A59%3A59.999Z");

  it("reports a dispatch query failure instead of claiming the day has zero trips", async () => {
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("FROM dispatchschedules ds")) throw new Error("dispatch feed unavailable");
      return { rows: [] };
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
  });

  it("reports a driver roster failure instead of claiming zero available drivers", async () => {
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("FROM drivers d")) throw new Error("driver feed unavailable");
      return { rows: [] };
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
  });

  it("returns a scheduled dispatch and its available driver when core feeds succeed", async () => {
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("FROM dispatchschedules ds")) return { rows: [{ dispatch_id: 622, status: "Scheduled", scheduled_departure: "2026-10-02T07:00:00Z" }] };
      if (sql.includes("FROM drivers d")) return { rows: [{ driver_id: 19, driver_status: "Available" }] };
      return { rows: [] };
    });
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.dispatches).toHaveLength(1);
    expect(body.drivers).toHaveLength(1);
  });
});
