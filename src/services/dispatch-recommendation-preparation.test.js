import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/services/route-resolver.service", () => ({
  estimateForRequest: vi.fn(),
  resolveRequestEstimate: vi.fn(),
  resolveRouteEndpoints: vi.fn(async () => null),
}));

import { query } from "@/lib/db";
import { resolveRequestEstimate } from "@/services/route-resolver.service";
import {
  fetchCandidates,
  prefilterReason,
  loadServiceDateWorkload,
  withResolvedEstimate,
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

it("propagates a strict v2 unknown estimate over stale persisted request fields", async () => {
  const request = {
    ...REQUEST,
    external_create_fingerprint: "persisted-v2",
    estimated_distance: 88,
    estimated_duration: 120,
    estimate_source: "TomTom",
  };
  const unknownEstimate = { distanceKm: null, durationMin: null, source: null, basis: "Canonical location unavailable" };
  resolveRequestEstimate.mockResolvedValue(unknownEstimate);

  const resolved = await withResolvedEstimate(request);

  expect(resolved.estimate).toEqual(unknownEstimate);
  expect(resolved.request).toMatchObject({ estimated_distance: null, estimated_duration: null, estimate_source: null });
});

it("retains legacy persisted estimates when the v1 resolver is unknown", async () => {
  resolveRequestEstimate.mockResolvedValue({ distanceKm: null, durationMin: null, source: null });

  const resolved = await withResolvedEstimate({ ...REQUEST, estimated_distance: 22, estimated_duration: 35, estimate_source: "Manual" });

  expect(resolved.request).toMatchObject({ estimated_distance: 22, estimated_duration: 35, estimate_source: "Manual" });
});

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
  it("explains cargo exclusions in kilograms with required, capacity and excess", () => {
    const request = { load_type: "Cargo", passenger_count: null, cargo_weight_kg: 1400, cargo_description: "Rice" };
    expect(
      prefilterReason({ vehicle_id: 9, plate_number: "TRK 9", operational_use: "Cargo", cargo_capacity_kg: 1000 }, 1, request)
    ).toBe("Vehicle TRK 9 cargo capacity 1000 kg, request needs 1400 kg (over by 400 kg).");
    // A passenger coach never reaches the payload comparison: use mismatch, not seats.
    expect(
      prefilterReason({ vehicle_id: 10, plate_number: "BUS 10", operational_use: "Passenger", seating_capacity: 49 }, 1, request)
    ).toMatch(/not a cargo vehicle/);
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

  it("loads every license column the eligibility gate reads (RS-7C7G)", async () => {
    // The pair engine judges licenses from these rows. A missing column reads
    // as a missing license detail — the roster once omitted all of them, so a
    // complete license in the database was reported as "license number is
    // missing" for every driver.
    mockDb();
    await fetchCandidates(REQUEST, TRIP);
    const rosterCall = query.mock.calls.find((c) =>
      String(c[0]).includes("FROM drivers d")
    );
    expect(rosterCall).toBeDefined();
    for (const column of [
      "d.license_number",
      "d.license_type",
      "d.license_class",
      "d.license_expiry",
      "d.license_verified_at",
      "d.license_verified_by",
      "d.license_verification_method",
    ]) {
      expect(String(rosterCall[0])).toContain(column);
    }
  });

  it("keeps soft-deleted vehicles hidden at the SQL level", async () => {
    mockDb();
    await fetchCandidates(REQUEST, TRIP);
    const prefilterCall = query.mock.calls.find((c) =>
      String(c[0]).includes("vehicle_status = ANY")
    );
    expect(String(prefilterCall[0])).toContain("deleted_at IS NULL");
  });

  it("filters typed cargo candidates on usable payload, never on seats", async () => {
    mockDb();
    const cargoRequest = {
      ...REQUEST,
      load_type: "Cargo",
      passenger_count: null,
      cargo_weight_kg: 900,
      cargo_description: "Vegetables",
    };
    await fetchCandidates(cargoRequest, TRIP);
    const mainCall = query.mock.calls.find((c) => String(c[0]).includes("WITH usage"));
    expect(String(mainCall[0])).toMatch(/operational_use = 'Cargo'/);
    expect(String(mainCall[0])).toMatch(/cargo_capacity_kg >= \$1::numeric/);
    expect(String(mainCall[0])).not.toMatch(/seating_capacity >=/);
    expect(mainCall[1][0]).toBe(900);
    const prefilterCall = query.mock.calls.find((c) =>
      String(c[0]).includes("vehicle_status = ANY")
    );
    expect(String(prefilterCall[0])).toMatch(/operational_use IS DISTINCT FROM 'Cargo'/);
    expect(String(prefilterCall[0])).toMatch(/v\.operational_use, v\.cargo_capacity_kg/);
  });

  it("keeps the seats prefilter for untyped requests", async () => {
    mockDb();
    await fetchCandidates(REQUEST, TRIP);
    const mainCall = query.mock.calls.find((c) => String(c[0]).includes("WITH usage"));
    expect(String(mainCall[0])).toMatch(/seating_capacity >= \$1::int/);
    expect(String(mainCall[0])).not.toMatch(/cargo_capacity_kg/);
  });
});

it('admits typed renewed-document candidates past stale registration status but retains hard status exclusions',async()=>{
 mockDb();
 await fetchCandidates({...REQUEST,load_type:'Passenger'},TRIP);
 const main=query.mock.calls.find(([sql])=>sql.includes('WITH usage'));
 const excluded=query.mock.calls.find(([sql])=>sql.includes('vehicle_status = ANY'));
 expect(main[1][4]).toEqual(['Under Maintenance','Decommissioned']);
 expect(excluded[1][2]).toEqual(main[1][4]);
});
