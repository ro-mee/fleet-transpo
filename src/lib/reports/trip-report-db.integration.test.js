import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnvLocal } from "../../../scripts/load-env.mjs";

const connection = vi.hoisted(() => ({ client: null, pending: Promise.resolve() }));
// The report selectors/builders remain real. Only their DB connection is
// redirected to one PostgreSQL session whose tables are temporary clones.
vi.mock("@/lib/db", async importOriginal => ({
  ...await importOriginal(),
  query: (sql, values = []) => {
    if (!connection.client) throw new Error("Temporary report connection is not initialized.");
    if (/\bpublic\s*\./i.test(sql)) throw new Error("Public-qualified application queries are forbidden in this fixture test.");
    // Selectors use Promise.all; serialize on the one isolated pg session.
    const result = connection.pending.then(() => connection.client.query(sql, values));
    connection.pending = result.catch(() => {});
    return result;
  },
}));
// Authentication is a separate boundary; this suite proves real SQL/rows/files.
vi.mock("@/lib/api/utils", () => ({
  requirePermission: async () => ({}),
  parseBody: async req => req.json(),
  ok: data => Response.json(data),
  err: (error, status) => Response.json({ error }, { status }),
  handleError: error => Response.json({ error: error.message }, { status: error.status || 500 }),
}));
import { getPool } from "@/lib/db";
import { SERVICE_CODES } from "@/lib/integration/contracts";
import { GET as jsonGet } from "@/app/api/reports/trip-performance/route";
import { GET as excelGet } from "@/app/api/reports/trip-performance/excel/route";
import { GET as listGet } from "@/app/api/trips/route";
import { getFleetUtilizationReport } from "./operational-reports";
import { buildFleetUtilizationWorkbook } from "./remaining-workbooks";

const enabled = process.env.FLEETOPS_REVIEW_DB_TEST === "1";
const request = (service, extra = {}) => new Request(`http://localhost/api/test?${new URLSearchParams({
  from: "2026-10-01", to: "2026-10-07", status: "Completed", search: "REVTST", ...(service ? { service } : {}), ...extra,
})}`);
async function decode(bytes) { const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes); return book; }

describe.skipIf(!enabled)("real PostgreSQL report rows to JSON and decoded workbook (temporary fixtures only)", () => {
  let pool;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) loadEnvLocal([".env.local", ".env", "../../.env.local", "../../.env"]);
    pool = getPool(); connection.client = await pool.connect();
    const q = (sql, values = []) => connection.client.query(sql, values);
    await q("BEGIN"); await q("SET LOCAL statement_timeout = 15000");
    // Defaults/identity/triggers/FKs are deliberately NOT copied: explicit IDs
    // cannot advance production sequences, and temp inserts cannot touch fleet
    // rows via production triggers. CHECK constraints and real column types stay.
    const tables = ["trips", "vehicles", "drivers", "employees", "dispatchschedules", "routes", "locations", "transportation_requests", "service_types", "fuel_price_snapshots"];
    for (const table of tables) await q(`CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING CONSTRAINTS) ON COMMIT DROP`);
    await q("SET LOCAL search_path = pg_temp, public");
    for (const table of tables) {
      const { rows } = await q("SELECT to_regclass($1)::oid = to_regclass($2)::oid AS isolated", [table, `pg_temp.${table}`]);
      expect(rows[0].isolated).toBe(true);
    }
    await q("INSERT INTO vehicles(vehicle_id,vehicle_name,plate_number,cargo_capacity_kg,vehicle_status) VALUES(1,'Temporary report truck','REVTST1',1000,'Available'),(2,'Unknown capacity fixture','REVTST2',NULL,'Available')");
    await q("INSERT INTO employees(employee_id,first_name,last_name,email,status,auth_version,must_change_password) VALUES(8,'Report','Fixture','report@example.invalid','Active',1,false)");
    await q("INSERT INTO drivers(driver_id,employee_id,license_number,standby_tracking_enabled) VALUES(7,8,'REVIEW-REPORT',false)");
    await q("INSERT INTO fuel_price_snapshots(snapshot_id,fuel_product,region,currency,unit,reference_price,effective_at,source_url,verification_method,lifecycle,verified_by,created_at) VALUES(4,'Diesel','NCR','PHP','L',62.70,'2026-10-01T00:00:00+08:00','https://example.gov/review-price','Manual','Historical',8,NOW())");
    for (const [index, code] of SERVICE_CODES.entries()) {
      const id = index + 1, cargo = index >= 2;
      await q("INSERT INTO service_types(service_type_id,service_name,service_code,default_load_type) VALUES($1,$2,$2,$3)", [id, code, cargo ? "Cargo" : "Passenger"]);
      await q(`INSERT INTO transportation_requests(request_id,source_system,pickup_location,dropoff_location,pickup_datetime,priority,fleet_status,is_vip,is_emergency,service_type_id,load_type,passenger_count,cargo_weight_kg,cargo_description)
        VALUES($1,'POS','Review supplier','Review hotel','2026-10-03T08:00:00+08:00','Low','Completed',false,false,$1,$2,$3,$4,$5)`, [id, cargo ? "Cargo" : "Passenger", cargo ? null : 2, cargo ? 650 : null, cargo ? "Temporary vegetables" : null]);
      // Migration 148 reserves SUPPLY_DELIVERY for the independent allocation
      // workflow; typed request cargo still uses dispatch service PASSENGER.
      await q("INSERT INTO dispatchschedules(dispatch_id,dispatch_number,request_id,service_type,status) VALUES($1,$2,$1,'PASSENGER','Completed')", [id, `REVTST-${id}`]);
      await q(`INSERT INTO trips(trip_id,vehicle_id,driver_id,dispatch_id,trip_status,start_time,end_time,distance,at_pickup_override,
        planned_distance_km,actual_distance_km,planned_estimated_fuel_l,planned_estimated_fuel_cost,estimated_fuel_l,estimated_fuel_cost,fuel_reference_price,fuel_price_snapshot_id,fuel_region,distance_provenance)
        VALUES($1,1,7,$1,'Completed','2026-10-03T08:00:00+08:00','2026-10-03T09:00:00+08:00',36,false,32,36,3.556,222.96,4,250.8,62.7,4,'NCR','odometer')`, [id]);
    }
    // A real typed cargo row with absent capacity must never export 0%.
    await q("INSERT INTO transportation_requests(request_id,source_system,pickup_location,pickup_datetime,priority,fleet_status,is_vip,is_emergency,service_type_id,load_type,passenger_count,cargo_weight_kg,cargo_description) VALUES(6,'POS','Supplier','2026-10-03T08:00:00+08:00','Low','Completed',false,false,3,'Cargo',NULL,650,'Unknown capacity fixture')");
    await q("INSERT INTO dispatchschedules(dispatch_id,dispatch_number,request_id,service_type,status) VALUES(6,'REVTST-6',6,'PASSENGER','Completed')");
    await q("INSERT INTO trips(trip_id,vehicle_id,driver_id,dispatch_id,trip_status,start_time,distance,at_pickup_override) VALUES(6,2,7,6,'Completed','2026-10-03T08:00:00+08:00',20,false)");
    // Independent supply dispatch has no transportation request. This is the
    // existing main workflow, not a fourth typed cargo request fixture.
    await q("INSERT INTO dispatchschedules(dispatch_id,dispatch_number,request_id,service_type,status) VALUES(7,'REVTST-7',NULL,'SUPPLY_DELIVERY','Completed')");
    await q("INSERT INTO trips(trip_id,vehicle_id,driver_id,dispatch_id,trip_status,start_time,distance,at_pickup_override) VALUES(7,1,7,7,'Completed','2026-10-03T08:00:00+08:00',40,false)");
  }, 60000);
  afterAll(async () => {
    if (connection.client) { try { await connection.client.query("ROLLBACK"); } finally { connection.client.release(); connection.client = null; } }
    if (pool) { await pool.end(); delete globalThis.postgresPool; }
  });
  it.each(SERVICE_CODES)("filters real %s request/trip rows identically in JSON, register and XLSX", async service => {
    const response = await jsonGet(request(service)); expect(response.status).toBe(200);
    const report = await response.json(); expect(report.trips.length).toBeGreaterThan(0);
    expect(report.trips.every(row => row.transportation_requests.service_code === service)).toBe(true);
    const list = await listGet(request(service, { page: "1", pageSize: "100" })); expect(list.status).toBe(200);
    const visible = await list.json();
    expect(visible.rows.map(row => row.trip_id)).toEqual(report.trips.map(row => row.trip_id));
    const excel = await excelGet(request(service)); expect(excel.status).toBe(200);
    const details = (await decode(await excel.arrayBuffer())).getWorksheet("Details");
    const headers = details.getRow(1).values;
    expect(details.rowCount).toBe(report.trips.length + 1); expect(details.columnCount).toBe(28);
    for (const [index, row] of report.trips.entries()) {
      const value = name => details.getRow(index + 2).getCell(headers.indexOf(name)).value;
      expect(value("Trip ID")).toBe(row.trip_id); expect(value("Service")).toBe(service);
      const estimate = row.fuel_estimate;
      expect(value("Planned km")).toBe(estimate.planned_distance_km);
      expect(value("Actual km")).toBe(estimate.actual_distance_km);
      expect(value("Planned estimated fuel (L)")).toBe(estimate.planned_estimated_fuel_l);
      expect(value("Planned estimated cost (PHP)")).toBe(estimate.planned_estimated_fuel_cost_php);
      expect(value("Actual estimated fuel (L)")).toBe(estimate.estimated_fuel_l);
      expect(value("Actual estimated cost (PHP)")).toBe(estimate.estimated_fuel_cost_php);
      if (estimate.price_source) {
        expect(value("Price source")).toContain(estimate.price_source.source_url);
        expect(value("Price effective at").toISOString()).toBe(new Date(estimate.price_source.effective_at).toISOString());
        expect(value("Reference price (PHP/L)")).toBe(62.7);
      } else expect(value("Estimate availability")).toBe("Unavailable");
    }
    expect((await jsonGet(request(service, { search: "NO-MATCH" }))).status).toBe(200);
    expect((await (await jsonGet(request(service, { search: "NO-MATCH" }))).json()).trips).toEqual([]);
    expect((await (await jsonGet(request(service, { status: "Cancelled" }))).json()).trips).toEqual([]);
  });
  it("decodes typed request cargo under PASSENGER while excluding independent supply activity and unknown capacity", async () => {
    const report = await getFleetUtilizationReport("2026-10-01", "2026-10-07");
    expect(report.totalTrips).toBe(6); expect(report.totalDistance).toBe(200);
    expect(report.trips.map(row => row.trip_id)).not.toContain(7);
    expect(report.trips.filter(row => row.load_type === "Cargo").length).toBe(4);
    expect(report.cargoUtilization.trips).toBe(3); expect(report.cargoUtilization.average_pct).toBe(65);
    const sheet = (await decode(await buildFleetUtilizationWorkbook(report, {}))).getWorksheet("Cargo Utilization");
    expect(sheet.rowCount).toBe(4);
    for (let row = 2; row <= 4; row++) { expect(sheet.getCell(`F${row}`).value).toBe(0.65); expect(sheet.getCell(`F${row}`).numFmt).toBe("0.0%"); expect(sheet.getCell(`A${row}`).value).not.toBe(6); }
  });
  it.each([jsonGet, excelGet, listGet])("rejects unknown service on the real query path", async handler => {
    expect((await handler(request("UNKNOWN"))).status).toBe(400);
  });
});
