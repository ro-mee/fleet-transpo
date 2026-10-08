import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { loadEnvLocal } from "../../../scripts/load-env.mjs";
import { POST, PATCH } from "@/app/api/fuel/reference-prices/route";
import { PUT } from "@/app/api/trips/[id]/complete/route";
import { completeTrip } from "@/services/trip-lifecycle.service";

const adapter = vi.hoisted(() => ({ query: null, transaction: null }));
vi.mock("@/lib/db", () => ({
  query: (...args) => adapter.query(...args),
  withTransaction: (...args) => adapter.transaction(...args),
  getPool: () => ({ options: { max: 10 }, totalCount: 0, waitingCount: 0, idleCount: 0 }),
  getAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
}));
// Identity is the external boundary. No application service/repository is mocked.
vi.mock("@/lib/api/utils", () => ({
  AuthError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } },
  requirePermission: async () => ({ user: { employeeId: 3, role: "fleet_manager" } }),
  parseBody: (req) => req.json(), ok: (data, status = 200) => Response.json(data, { status }),
  err: (error, status) => Response.json({ error }, { status }),
  handleError: (error) => Response.json({ error: error.message }, { status: error.status || 500 }),
}));

const tables = ["trips", "vehicles", "transportation_requests", "dispatchschedules", "gpstracking", "fuel_price_snapshots", "system_settings", "trip_monitor_alerts", "audit_logs"];
const enabled = process.env.FLEETOPS_REVIEW_DB_TEST === "1";
let pool; let admin; let schema; let pauseCapture; let lockedPids; let fixtureQuery;
const request = (url, method, body) => new Request(`https://local${url}`, { method, body: JSON.stringify(body) });
const complete = (body) => PUT(request("/api/trips/1/complete", "PUT", body), { params: Promise.resolve({ id: 1 }) });

// All mutation targets are fixture tables; public business DML is forbidden.
function assertFixtureDml(sql) {
  for (const match of sql.matchAll(/\b(?:INSERT\s+INTO|UPDATE\s+(?!OF\b|SET\b)|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s*([a-z_][a-z_0-9.]*)/gi)) {
    if (!tables.includes(match[1].toLowerCase())) throw new Error("Review DML escaped the fixture table allowlist.");
  }
}

describe.skipIf(!enabled)("opt-in PostgreSQL fuel closeout in an isolated private fixture schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) loadEnvLocal([".env.local", ".env", "../../.env.local", "../../.env"]);
    schema = `fleetops_review_${randomBytes(12).toString("hex")}`;
    if (!/^fleetops_review_[a-f0-9]{24}$/.test(schema)) throw new Error("Invalid fixture schema name.");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000 });
    admin = await pool.connect();
    await admin.query("BEGIN");
    await admin.query("SET LOCAL statement_timeout = '8s'");
    await admin.query("SET LOCAL search_path TO pg_catalog");
    await admin.query(`CREATE SCHEMA "${schema}"`);
    // CTAS copies current live column types, no defaults/sequences/FKs/triggers.
    // Live production constraints/security are covered by the separate catalog gate.
    for (const name of tables) await admin.query(`CREATE TABLE "${schema}"."${name}" AS TABLE public."${name}" WITH NO DATA`);
    await admin.query(`ALTER TABLE "${schema}".trips ADD PRIMARY KEY (trip_id)`);
    await admin.query(`ALTER TABLE "${schema}".system_settings ADD UNIQUE (setting_key)`);
    // The real audit insert uses ON CONFLICT(event_key) WHERE event_key IS NOT NULL.
    await admin.query(`CREATE UNIQUE INDEX audit_logs_event_key_review ON "${schema}".audit_logs (event_key) WHERE event_key IS NOT NULL`);
    await admin.query(`ALTER TABLE "${schema}".fuel_price_snapshots ALTER COLUMN snapshot_id SET DEFAULT 44`);
    await admin.query(`ALTER TABLE "${schema}".fuel_price_snapshots ALTER COLUMN currency SET DEFAULT 'PHP', ALTER COLUMN unit SET DEFAULT 'L'`);
    await admin.query("COMMIT");
    const localSettings = async (client) => {
      await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
      await client.query("SET LOCAL statement_timeout = '8s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
    };
    const checkedQuery = (client, backendPid) => async (sql, params) => {
      assertFixtureDml(sql);
      if (sql.includes("FOR UPDATE OF t")) lockedPids.push(backendPid);
      if (sql.includes("UPDATE trips") && pauseCapture) await pauseCapture();
      // Checked inside the pinned transaction immediately before every query.
      const scope = await client.query("SELECT current_schema() AS schema");
      if (scope.rows[0].schema !== schema) throw new Error("Review query escaped its transaction-local fixture schema.");
      return client.query(sql, params);
    };
    fixtureQuery = async (sql, params) => {
      await admin.query("BEGIN");
      try { await localSettings(admin); const result = await checkedQuery(admin, null)(sql, params); await admin.query("COMMIT"); return result; }
      catch (error) { await admin.query("ROLLBACK"); throw error; }
    };
    adapter.transaction = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN"); await localSettings(client);
        const backendPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        const result = await fn({ query: checkedQuery(client, backendPid) });
        await client.query("COMMIT"); return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    };
    adapter.query = (sql, params) => adapter.transaction((tx) => tx.query(sql, params));
  }, 30000);

  beforeEach(async () => {
    pauseCapture = null; lockedPids = [];
    await fixtureQuery(`TRUNCATE ${tables.join(",")};
      INSERT INTO vehicles (vehicle_id,mileage,fuel_efficiency_kmpl,fuel_type) VALUES (5,1000,9,'Diesel');
      INSERT INTO transportation_requests (request_id,pickup_location,pickup_datetime,fleet_status) VALUES (55,'Fixture only',NOW(),'Pending');
      INSERT INTO dispatchschedules (dispatch_id,status) VALUES (55,'In Progress');
      INSERT INTO trips (trip_id,vehicle_id,driver_id,dispatch_id,trip_status,distance,start_time) VALUES (1,5,7,55,'Trip Started',32,NOW()-INTERVAL '31 minutes')`);
    expect((await PATCH(request("/api/fuel/reference-prices", "PATCH", { region: "NCR" }))).status).toBe(200);
    const response = await POST(request("/api/fuel/reference-prices", "POST", { fuel_product: "Diesel", region: "NCR", reference_price: "62.70", effective_at: "2020-01-01T00:00:00+08:00", source_url: "https://fixture.example/dated-price", verified_by: 999 }));
    expect(response.status).toBe(201);
    const snapshot = (await response.json()).snapshot;
    expect(String(snapshot.snapshot_id)).toBe("44");
    expect(snapshot).toMatchObject({ verified_by: 3, verification_method: "Manual" });
    expect(Number((await fixtureQuery("SELECT COUNT(*) AS count FROM audit_logs WHERE resource='fuelallocations'")).rows[0].count)).toBe(2);
  }, 30000); // Real route/repository round trips follow one batched fixture transaction.

  afterAll(async () => {
    if (!admin) { if (pool) await pool.end(); return; }
    try {
      await admin.query("ROLLBACK"); // Also clears a failed setup transaction.
      await admin.query("BEGIN");
      await admin.query("SET LOCAL search_path TO pg_catalog");
      await admin.query("SET LOCAL statement_timeout = '8s'");
      await admin.query("SET LOCAL lock_timeout = '5s'");
      if (!/^fleetops_review_[a-f0-9]{24}$/.test(schema)) throw new Error("Refusing cleanup outside fixture namespace.");
      const owned = await admin.query("SELECT nspname FROM pg_namespace WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)", [schema]);
      if (owned.rows.length !== 1) throw new Error("Fixture schema ownership could not be verified.");
      const found = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema]);
      if (found.rows.some((row) => !tables.includes(row.tablename))) throw new Error("Unexpected table in fixture schema; refusing recursive cleanup.");
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.query("COMMIT");
      expect((await admin.query("SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname=$1", [schema])).rows).toEqual([]);
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    finally { admin.release(); await pool.end(); }
  }, 15000);

  it("persists the manual route snapshot and completion basis as real PostgreSQL rows", async () => {
    const response = await complete({ distance: 36 });
    expect(response.status).toBe(200);
    const { rows: [row] } = await fixtureQuery("SELECT * FROM trips WHERE trip_id=1");
    expect(row).toMatchObject({ trip_status: "Completed", fuel_region: "NCR", distance_provenance: "trip-distance", fuel_estimate_reason: null });
    expect(String(row.fuel_price_snapshot_id)).toBe("44");
    expect([row.actual_distance_km,row.fuel_efficiency_snapshot_kmpl,row.fuel_reference_price,row.estimated_fuel_l,row.estimated_fuel_cost,row.planned_estimated_fuel_l,row.planned_estimated_fuel_cost].map(Number)).toEqual([36,9,62.7,4,250.8,3.556,222.96]);
    expect(row.fuel_estimate_captured_at).toBeInstanceOf(Date);
    expect(Number((await fixtureQuery("SELECT COUNT(*) AS count FROM audit_logs WHERE resource='trips' AND action='update'")).rows[0].count)).toBe(1);
  });

  it("persists server GPS distance separately from the 32km plan", async () => {
    await fixtureQuery("INSERT INTO gpstracking (tracking_id,vehicle_id,trip_id,latitude,longitude,recorded_at) VALUES (1,5,1,14,121,NOW()-INTERVAL '30 minutes'),(2,5,1,14.1,121,NOW())");
    expect((await complete({})).status).toBe(200);
    const { rows: [row] } = await fixtureQuery("SELECT * FROM trips WHERE trip_id=1");
    expect(Number(row.actual_distance_km)).toBeGreaterThan(11); expect(Number(row.actual_distance_km)).toBeLessThan(12);
    expect(Number(row.planned_distance_km)).toBe(32); expect(row.distance_provenance).toBe("gps-trail");
    expect(row.estimated_fuel_cost).not.toBe(row.planned_estimated_fuel_cost);
  });

  it("blocks a second real PostgreSQL client and preserves the whole first snapshot", async () => {
    let release; let entered;
    const paused = new Promise((resolve) => { entered = resolve; });
    const resume = new Promise((resolve) => { release = resolve; });
    pauseCapture = async () => { entered(); await resume; };
    const first = completeTrip(1, { user: { employeeId: 3 } }, { distance: 36 });
    await paused;
    const second = completeTrip(1, { user: { employeeId: 3 } }, { distance: 40 });
    let blocked = false;
    try {
      for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
        if (lockedPids.length === 2) {
          const result = await admin.query("SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked", [lockedPids[0],lockedPids[1]]);
          blocked = result.rows[0].blocked;
        }
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally { release(); }
    const [a,b] = await Promise.all([first,second]);
    expect(lockedPids[0]).not.toBe(lockedPids[1]); expect(blocked).toBe(true);
    for (const row of [a,b]) {
      expect(Number(row.actual_distance_km)).toBe(36); expect(Number(row.estimated_fuel_cost)).toBe(250.8);
      expect(Number(row.fuel_efficiency_snapshot_kmpl)).toBe(9); expect(Number(row.fuel_reference_price)).toBe(62.7);
      expect(String(row.fuel_price_snapshot_id)).toBe("44"); expect(row.fuel_region).toBe("NCR"); expect(row.fuel_estimate_reason).toBeNull();
      expect(Number(row.planned_distance_km)).toBe(32); expect(Number(row.planned_estimated_fuel_cost)).toBe(222.96);
      expect(Number(row.estimated_fuel_l)).toBe(4); expect(Number(row.planned_estimated_fuel_l)).toBe(3.556);
      expect(row.distance_provenance).toBe("trip-distance"); expect(row.fuel_estimate_captured_at).toBeInstanceOf(Date);
    }
    expect(a.fuel_estimate_captured_at).toEqual(b.fuel_estimate_captured_at);
    expect(Number((await fixtureQuery("SELECT actual_distance_km FROM trips WHERE trip_id=1")).rows[0].actual_distance_km)).toBe(36);
    expect(Number((await fixtureQuery("SELECT COUNT(*) AS count FROM audit_logs WHERE resource='trips' AND action='update'")).rows[0].count)).toBe(1);
  }, 15000);
});
