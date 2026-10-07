import { describe, expect, it } from "vitest";
import { planTypedDemo, seedTypedDemo, removeTypedDemo, DEMO_KEY } from "../../../scripts/lib/typed-demo.mjs";

const cargo = { source_system: "POS", external_request_id: "cargo-fit", service_code: "RESTAURANT_SUPPLY_PICKUP", load_type: "Cargo", cargo_weight_kg: 650, cargo_description: "Explicit acceptance fixture", pickup_location: "Fixture origin", dropoff_location: "Fixture destination", pickup_datetime: "2026-10-07T10:00:00+08:00" };
const manifest = { isolated: true, requests: [cargo] };
function database() {
  const calls = [];
  const db = { calls, query: async (sql, params = []) => {
    calls.push([sql, params]);
    if (sql.includes("FROM service_types")) return { rows: [{ service_type_id: 3, service_code: cargo.service_code, default_load_type: "Cargo" }] };
    if (sql.startsWith("INSERT INTO transportation_requests")) return { rows: [{ request_id: 42 }] };
    if (sql.includes("FROM system_settings")) return { rows: [] };
    return { rows: [] };
  } };
  return db;
}
describe("opt-in typed demo preparation", () => {
  it("plans supplied fixtures deterministically without adding identities or defaults", () => {
    expect(planTypedDemo(manifest)).toEqual(planTypedDemo(manifest));
    expect(planTypedDemo(manifest)[0]).toEqual(cargo);
    expect(planTypedDemo(manifest)[0]).not.toHaveProperty("passenger_count");
  });
  it("rejects missing declarations, source mismatch, unknown service and absent time offset", () => {
    for (const patch of [{ cargo_weight_kg: undefined }, { cargo_weight_kg: true }, { source_system: "PMS" }, { service_code: "INVENTED" }, { pickup_datetime: "2026-10-07T10:00:00" }, { pickup_datetime: "2026-02-30T10:00:00+08:00" }]) {
      expect(() => planTypedDemo({ ...manifest, requests: [{ ...cargo, ...patch }] })).toThrow();
    }
    expect(() => planTypedDemo({ ...manifest, isolated: false })).toThrow();
  });
  it("writes only supplied requests and a ledger in the same transaction", async () => {
    const db = database();
    const ledger = await seedTypedDemo(db, manifest);
    expect(ledger.request_ids).toEqual([42]);
    expect(db.calls[0][0]).toBe("BEGIN");
    expect(db.calls.at(-1)[0]).toBe("COMMIT");
    expect(db.calls.some(([sql]) => /UPDATE vehicles|INSERT INTO vehicles|INSERT INTO drivers/.test(sql))).toBe(false);
    expect(db.calls.find(([sql]) => sql.startsWith("INSERT INTO system_settings"))[1][0]).toBe(DEMO_KEY);
  });
  it("rolls back rather than inventing a missing catalog service", async () => {
    const db = database();
    const query = db.query;
    db.query = async (sql, params) => sql.includes("FROM service_types") ? { rows: [] } : query(sql, params);
    await expect(seedTypedDemo(db, manifest)).rejects.toThrow(/service/i);
    expect(db.calls.at(-1)[0]).toBe("ROLLBACK");
  });
  it("removes only exact ledger ids and refuses a fixture used by dispatch", async () => {
    const db = database();
    const query = db.query;
    db.query = async (sql, params) => {
      if (sql.includes("FROM system_settings")) return { rows: [{ setting_value: { version: 1, request_ids: [42] } }] };
      return query(sql, params);
    };
    await removeTypedDemo(db);
    expect(db.calls.find(([sql]) => sql.startsWith("DELETE FROM transportation_requests"))[1]).toEqual([[42]]);
    const used = database();
    used.query = async (sql) => ({ rows: sql.includes("FROM system_settings") ? [{ setting_value: { version: 1, request_ids: [42] } }] : sql.includes("FROM dispatchschedules") ? [{ dispatch_id: 12 }] : [] });
    await expect(removeTypedDemo(used)).rejects.toThrow(/dispatch/i);
  });
});
