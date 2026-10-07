import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";

afterEach(() => vi.restoreAllMocks());

describe("GET /api/integration/transport-requests departing-soon filter", () => {
  it("uses one exact SQL set for the queue rows and total", async () => {
    vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { role: "dispatcher" } });
    const query = vi.spyOn(db, "query").mockResolvedValue({ rows: [] });

    const response = await GET(new Request(
      "http://localhost/api/integration/transport-requests?tab=today&page=1&pageSize=25&filter=departing-soon"
    ));

    expect(response.status).toBe(200);
    const filteredCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes("tr.pickup_datetime >= NOW()")
    );
    expect(filteredCalls).toHaveLength(2);
    for (const [sql] of filteredCalls) {
      expect(sql).toContain("(tr.vehicle_id IS NULL OR tr.driver_id IS NULL)");
      expect(sql).toContain("tr.pickup_datetime <= NOW() + INTERVAL '30 minutes'");
      expect(sql).toContain("tr.fleet_status NOT IN ('Assigned','In Progress','Completed','Cancelled')");
    }
  });
});
