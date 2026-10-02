import { describe, expect, it } from "vitest";
import { checkSnapshots } from "./ledger.mjs";

describe("defense ownership snapshots", () => {
  it("ignores only a routine vehicle timestamp in read-only status mode", async () => {
    const ledger = { ids: { vehicles: [42] }, snapshots: {
      vehicles: { "42": { vehicle_id: 42, vehicle_status: "Available", updated_at: "2026-10-03T00:00:00Z" } },
    } };
    const db = { query: async () => ({ rows: [{ id: 42, snapshot: {
      vehicle_id: 42, vehicle_status: "Available", updated_at: "2026-10-03T01:00:00Z",
    } }] }) };
    expect(await checkSnapshots(db, ledger)).toEqual(["vehicles 42 changed since seed"]);
    expect(await checkSnapshots(db, ledger, { ignoreRuntimeTimestamps: true })).toEqual([]);
    ledger.snapshots.vehicles["42"].vehicle_status = "Decommissioned";
    expect(await checkSnapshots(db, ledger, { ignoreRuntimeTimestamps: true })).toEqual(["vehicles 42 changed since seed"]);
  });
});
