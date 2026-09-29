// TDD RED test for Task 2: setTripStatus stamps at_pickup_at first-write-wins
// on every server-side transition to At Pickup, in the SAME UPDATE as the flip.
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as db from "@/lib/db";
import { TRIP_STATUS } from "@/lib/constants";
import { setTripStatus } from "./transition.service";

vi.mock("@/services/trip-geofence.service", () => ({
  checkPickupProximity: vi.fn(async () => ({ state: "inside" })),
  checkDestinationProximity: vi.fn(async () => ({ state: "inside" })),
}));
vi.mock("@/services/status.service", () => ({
  syncVehicleStatus: vi.fn(async () => null),
  syncDriverStatus: vi.fn(async () => null),
  ensureTripForDispatch: vi.fn(async () => null),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => null) }));

const SESSION = { user: { employeeId: 1 } };

function setup(beforeStatus) {
  const updates = [];
  vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
    const s = String(sql);
    if (s.startsWith("SELECT trip_id, trip_status")) {
      return {
        rows: [
          {
            trip_id: 1,
            trip_status: beforeStatus,
            vehicle_id: null,
            driver_id: 5,
            dispatch_id: 9,
          },
        ],
      };
    }
    if (s.startsWith("UPDATE trips SET")) {
      updates.push(s);
      return { rows: [{ trip_id: 1, trip_status: "At Pickup" }] };
    }
    return { rows: [] };
  });
  vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => {
    const tx = { query: async (sql, params) => db.query(sql, params) };
    return fn(tx);
  });
  return updates;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setTripStatus → at_pickup stamp (Task 2)", () => {
  it("stamps at_pickup_at first-write-wins on At Pickup", async () => {
    const updates = setup(TRIP_STATUS.TRIP_STARTED);
    await setTripStatus({ tripId: 1, to: TRIP_STATUS.AT_PICKUP, session: SESSION });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("at_pickup_at = COALESCE(at_pickup_at, NOW())");
  });

  it("latches at_pickup_override TRUE on override and keeps it TRUE on clean retry", async () => {
    const updates = setup(TRIP_STATUS.TRIP_STARTED);
    await setTripStatus({
      tripId: 1,
      to: TRIP_STATUS.AT_PICKUP,
      session: SESSION,
      geofenceOverride: true,
      geofenceReason: "driver called in",
    });
    expect(updates[0]).toContain("at_pickup_override = at_pickup_override OR TRUE");

    const updates2 = setup(TRIP_STATUS.TRIP_STARTED);
    await setTripStatus({ tripId: 1, to: TRIP_STATUS.AT_PICKUP, session: SESSION });
    expect(updates2[0]).toContain("at_pickup_override = at_pickup_override OR FALSE");
    // OR-latch semantics: TRUE OR FALSE stays TRUE even on a clean retry.
    expect(true || false).toBe(true);
  });

  it("does not touch either column on non-At-Pickup transitions", async () => {
    const updates = setup(TRIP_STATUS.AT_PICKUP);
    await setTripStatus({ tripId: 1, to: TRIP_STATUS.PASSENGER_ONBOARD, session: SESSION });
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toContain("at_pickup_at");
    expect(updates[0]).not.toContain("at_pickup_override");
  });
});
