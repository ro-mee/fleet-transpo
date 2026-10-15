import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { loadEnvLocal } from "../../../../../scripts/load-env.mjs";

const adapter = vi.hoisted(() => ({ query: null }));
vi.mock("@/lib/db", () => ({ query: (...args) => adapter.query(...args) }));
vi.mock("@/lib/api/utils", () => ({ requirePermission: async () => ({ user: { role: "fleet_manager", employeeId: 8 } }), ok: (body) => Response.json(body), handleError: (e) => Response.json({ error: e.message }, { status: 500 }) }));
// These are independent gates; this fixture targets the real maintenance SQL.
vi.mock("@/lib/uvvrp/uvvrp.service", () => ({ loadVehicleTravelContext: async () => ({ pairings: [] }), vehicleCanTravel: () => true }));
import { GET } from "./route";
import { buildFuelDiagnosticPayload } from "@/lib/fuel/diagnostic";

const enabled = process.env.FLEETOPS_REVIEW_DB_TEST === "1";
const tables = ["vehicles", "vehiclecategories", "driverincidents", "vehiclemaintenance"];
let pool, client, instant;
describe.skipIf(!enabled)("real availability SQL for fuel diagnostics in rollback-only temporary tables", () => {
  beforeAll(async () => {
    loadEnvLocal([".env.local", ".env"]);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 5000 });
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '8s'");
    await client.query("SET LOCAL timezone = 'UTC'");
    for (const table of tables) await client.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS TABLE public.${table} WITH NO DATA`);
    await client.query("SET LOCAL search_path = pg_temp, pg_catalog");
    adapter.query = async (sql, values) => {
      // Only the SELECT emitted by the real handler is accepted. All business
      // relation reads are explicitly bound to this connection's temp tables.
      if (!sql.trim().startsWith("SELECT") || /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)) throw new Error("Only fixture SELECT is allowed.");
      const scoped = sql.replace(/\b(FROM|JOIN)\s+(vehicles|vehiclecategories|driverincidents|vehiclemaintenance)\b/gi, "$1 pg_temp.$2");
      // Freeze PostgreSQL's clock at the external boundary, keeping the
      // production date comparison and timezone conversion intact.
      const frozen = scoped.replace(/\bNOW\(\)/gi, `'${instant}'::timestamptz`).replace(/\bCURRENT_DATE\b/g, `'${instant.slice(0, 10)}'::date`);
      return client.query(frozen, values);
    };
  }, 20000);
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    try { if (client) await client.query("ROLLBACK"); }
    finally { client?.release(); await pool?.end(); }
  });

  it("lists the vehicle after filing and excludes it when the diagnostic becomes due at Manila midnight", async () => {
    vi.useFakeTimers();
    instant = "2026-12-31T15:59:59Z";
    vi.setSystemTime(new Date(instant));
    const diagnostic = buildFuelDiagnosticPayload({ vehicleId: 12, plate: "ABC 1234", estimatedKmpl: 6.4, baselineKmpl: 8.5, trips: 18, km: 1240, liters: 193, from: "2026-12-01", to: "2026-12-31" });
    expect(diagnostic.maintenance_date).toBe("2027-01-01");
    await client.query("INSERT INTO pg_temp.vehicles (vehicle_id, vehicle_status, plate_number) VALUES (12, 'Available', 'ABC 1234')");
    await client.query("INSERT INTO pg_temp.vehiclemaintenance (maintenance_id, vehicle_id, status, maintenance_date, maintenance_type, remarks) VALUES (44, 12, $1, $2, $3, $4)", [diagnostic.status, diagnostic.maintenance_date, diagnostic.maintenance_type, diagnostic.remarks]);
    const request = () => new Request("http://local/api/vehicles/available");
    let response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).map((v) => v.vehicle_id)).toEqual([12]);
    instant = "2026-12-31T16:00:00Z";
    vi.setSystemTime(new Date(instant));
    response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
