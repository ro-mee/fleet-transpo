import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import {
  fetchCandidates,
  prefilterReason,
  loadServiceDateWorkload,
} from "./dispatch-recommendation-preparation.service";
import { NON_DISPATCHABLE_VEHICLE_STATUSES } from "@/lib/ai/pair-scoring";

const REQUEST = {
  request_id: 502,
  passenger_count: 1,
  pickup_datetime: "2026-09-15T05:39:00.000Z",
  requested_category_id: 2,
  pickup_location: "Hotel",
  dropoff_location: "Airport",
};
const TRIP = { distanceKm: 10, durationMin: 30 };

function mockDb({ prefiltered = [] } = {}) {
  query.mockImplementation(async (sql) => {
    if (sql.includes("WITH usage")) return { rows: [] };
    if (sql.includes("FROM drivers d")) return { rows: [] };
    if (sql.includes("vehicle_status = ANY")) return { rows: prefiltered };
    throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
  });
}

beforeEach(() => vi.clearAllMocks());
it('uses the Manila service date and preserves unknown duration versus a recorded empty day',async()=>{
 query.mockResolvedValue({rows:[{driver_id:1,total:5,completed:2,active:1,scheduled:2,minutes:null}]});
 const workloads=await loadServiceDateWorkload([1,2],'2026-09-15T17:00:00Z');
 expect(query.mock.calls[0][1]).toEqual([[1,2],'2026-09-16']);
 expect(workloads.get(1)).toMatchObject({totalTrips:5,completedTrips:2,activeTrips:1,scheduledTrips:2,serviceMinutes:null});
 expect(workloads.get(2)).toMatchObject({totalTrips:0,complete:true});
 query.mockRejectedValue(new Error('unavailable'));
 await expect(loadServiceDateWorkload([1],'2026-09-16')).rejects.toThrow('unavailable');
});

describe("prefilterReason", () => {
  it("reports seating first, matching the engine's check order", () => {
    expect(
      prefilterReason({ seating_capacity: 2, vehicle_status: "Under Maintenance" }, 4)
    ).toBe("Seats 2 — too small for 4 passenger(s).");
  });
  it("reports the vehicle status when seating fits", () => {
    expect(
      prefilterReason({ seating_capacity: 5, vehicle_status: "Under Maintenance" }, 1)
    ).toBe("Vehicle status is Under Maintenance.");
  });
  it("falls back when neither applies", () => {
    expect(prefilterReason({ seating_capacity: null, vehicle_status: null }, 1)).toBe(
      "Excluded before evaluation."
    );
  });
});

describe("fetchCandidates prefiltered", () => {
  it("surfaces an Under Maintenance category-mate with its reason (RS-KXIH shape)", async () => {
    mockDb({
      prefiltered: [
        {
          vehicle_id: 1,
          plate_number: "XYZ 5678",
          vehicle_status: "Under Maintenance",
          seating_capacity: 5,
        },
      ],
    });
    const { prefiltered } = await fetchCandidates(REQUEST, TRIP);
    expect(prefiltered).toEqual([
      {
        vehicle_id: 1,
        plate: "XYZ 5678",
        reason: "Vehicle status is Under Maintenance.",
        prefiltered: true,
      },
    ]);
  });

  it("passes the passenger floor, category scope and dispatchable statuses", async () => {
    mockDb();
    await fetchCandidates(REQUEST, TRIP);
    const prefilterCall = query.mock.calls.find((c) =>
      String(c[0]).includes("vehicle_status = ANY")
    );
    expect(prefilterCall).toBeDefined();
    expect(prefilterCall[1][0]).toBe(1);
    expect(prefilterCall[1][1]).toBe(2);
    expect(prefilterCall[1][2]).toEqual(
      expect.arrayContaining(NON_DISPATCHABLE_VEHICLE_STATUSES)
    );
  });

  it("keeps soft-deleted vehicles hidden at the SQL level", async () => {
    mockDb();
    await fetchCandidates(REQUEST, TRIP);
    const prefilterCall = query.mock.calls.find((c) =>
      String(c[0]).includes("vehicle_status = ANY")
    );
    expect(String(prefilterCall[0])).toContain("deleted_at IS NULL");
  });
});
