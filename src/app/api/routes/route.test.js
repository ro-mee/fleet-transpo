import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import * as resolver from "@/services/route-resolver.service";
import * as tomtom from "@/lib/tomtom";
import * as audit from "@/lib/audit";

describe("POST /api/routes manual fallback", () => {
  let insert;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role: "admin", employeeId: 1 } });
    vi.spyOn(resolver, "resolveRouteEndpoints").mockResolvedValue({
      origin: "Hotel", destination: "Airport", originLocationId: 1, destinationLocationId: 2,
      originLocation: { latitude: 14.5, longitude: 121 },
      destinationLocation: { latitude: 14.6, longitude: 121.1 },
    });
    vi.spyOn(resolver, "findActiveRoute").mockResolvedValue(null);
    vi.spyOn(tomtom, "fetchTomTomEstimate").mockResolvedValue(null);
    vi.spyOn(audit, "writeAudit").mockResolvedValue(undefined);
    insert = vi.fn().mockResolvedValue({ rows: [{ route_id: 44, route_name: "Hotel to Airport" }] });
    vi.spyOn(db, "withTransaction").mockImplementation((work) => work({ query: insert }));
  });

  it("creates a new direction from manual distance and duration without calling TomTom", async () => {
    const request = new Request("http://localhost/api/routes", {
      method: "POST",
      body: JSON.stringify({ route_name: "Hotel to Airport", origin_location_id: 1, destination_location_id: 2, estimated_distance: 12.5, estimated_duration: 25, estimate_source: "Manual" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(tomtom.fetchTomTomEstimate).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledOnce();
    expect(insert.mock.calls[0][1]).toContain("Manual");
  });

  it("keeps an existing active direction protected from a duplicate", async () => {
    resolver.findActiveRoute.mockResolvedValue({ route_id: 5 });
    const request = new Request("http://localhost/api/routes", {
      method: "POST",
      body: JSON.stringify({ route_name: "Hotel to Airport", origin_location_id: 1, destination_location_id: 2, estimated_distance: 12.5, estimated_duration: 25, estimate_source: "Manual" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
  });
});
