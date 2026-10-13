import { describe, expect, it } from "vitest";
import { tripDriverTypeMismatch } from "./trip-type-gate";

// Real catalog codes (src/lib/integration/contracts.js): HOTEL_SUPPLY_TRANSFER
// is cargo, GUEST_TRANSPORT is passenger. No mocks — the gate reads them live.

function db({ driver = null, serviceCode = undefined } = {}) {
  return {
    query: async (sql) => {
      if (String(sql).includes("FROM drivers")) return { rows: driver ? [driver] : [] };
      if (String(sql).includes("dispatchschedules"))
        return serviceCode === undefined ? { rows: [] } : { rows: [{ service_code: serviceCode }] };
      return { rows: [] };
    },
  };
}

describe("tripDriverTypeMismatch", () => {
  it("blocks a Passenger driver on a cargo dispatch", async () => {
    const mismatch = await tripDriverTypeMismatch(
      db({ driver: { driver_id: 1, driver_type: "Passenger" }, serviceCode: "HOTEL_SUPPLY_TRANSFER" }),
      { driverId: 1, dispatchId: 9 }
    );
    expect(mismatch?.severity).toBe("blocking");
    expect(mismatch?.type).toBe("driver_type_mismatch");
  });

  it("passes a matching pair", async () => {
    const mismatch = await tripDriverTypeMismatch(
      db({ driver: { driver_id: 2, driver_type: "Cargo" }, serviceCode: "HOTEL_SUPPLY_TRANSFER" }),
      { driverId: 2, dispatchId: 9 }
    );
    expect(mismatch).toBeNull();
  });

  it("skips when there is no dispatch, no service, or no driver row", async () => {
    expect(await tripDriverTypeMismatch(db(), { driverId: 1, dispatchId: null })).toBeNull();
    expect(
      await tripDriverTypeMismatch(
        db({ driver: { driver_id: 1, driver_type: "Passenger" } }),
        { driverId: 1, dispatchId: 9 }
      )
    ).toBeNull();
    expect(
      await tripDriverTypeMismatch(db({ driver: null, serviceCode: "HOTEL_SUPPLY_TRANSFER" }), {
        driverId: 1,
        dispatchId: 9,
      })
    ).toBeNull();
  });
});
