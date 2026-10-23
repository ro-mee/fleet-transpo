import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { loadEnvLocal } from "../../../../scripts/load-env.mjs";
const h = vi.hoisted(() => ({ client: null, fail: null }));
vi.mock("@/lib/db", () => ({
  query: async () => { throw new Error("Global query must never run in this fixture"); },
  withTransaction: async (run) => {
    await h.client.query("SAVEPOINT request");
    try {
      const result = await run({ query: async (sql, values) => {
        if (h.fail === "schedule" && sql.startsWith("UPDATE vehicle_service_plans SET")) throw new Error("Fixture schedule failure");
        if (h.fail === "status" && sql.startsWith("UPDATE vehicles SET vehicle_status")) throw new Error("Fixture status failure");
        return h.client.query(sql, values);
      } });
      await h.client.query("RELEASE SAVEPOINT request"); return result;
    } catch (e) { await h.client.query("ROLLBACK TO SAVEPOINT request"); throw e; }
  },
}));
vi.mock("@/lib/api/utils", () => ({
  requirePermission: async () => ({ user: { role: "fleet_manager", employeeId: 888 } }),
  parseBody: (req) => req.body,
  ok: (data, status = 200) => Response.json(data, { status }),
  err: (error, status = 400) => Response.json({ error }, { status }),
  errValidation: (errors) => Response.json({ errors }, { status: 400 }),
  handleError: (e) => Response.json({ error: e.message }, { status: 500 }),
}));
vi.mock("@/lib/audit", () => ({ writeAuditRequired: async (tx, _req, _session, entry) => {
  if (h.fail === "audit") throw new Error("Fixture audit failure");
  return tx.query("INSERT INTO audit_logs(action) VALUES ($1)", [entry.action]);
} }));
vi.mock("@/lib/maintenance/notifications", () => ({ fanoutMaintenanceNotification: vi.fn() }));
import { PUT } from "./[id]/route";
import { POST } from "./route";
import { syncVehicleStatus } from "@/services/status.service";
const put = (body) => PUT({ body }, { params: Promise.resolve({ id: "123" }) });
// Every write is to connection-local temporary tables inside an outer rollback.
// No operating row, application sequence, public table, or public trigger is used.
describe.skipIf(process.env.MAINTENANCE_FIXTURE_DB_TEST !== "1")("maintenance writes on rollback-only PostgreSQL fixtures", () => {
  beforeAll(async () => {
    loadEnvLocal();
    h.client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    await h.client.connect(); await h.client.query("BEGIN");
    await h.client.query("SET LOCAL search_path TO pg_temp,pg_catalog; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='3s'");
    const checks = (await h.client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.vehicles'::regclass AND conname='chk_vehicle_status'")).rows;
    await h.client.query(`CREATE TEMP TABLE vehicles(vehicle_id int PRIMARY KEY, vehicle_status text, registration_expiry date, deleted_at timestamptz,
      mileage numeric, service_interval_days int, service_interval_km numeric, last_service_date date, next_service_date date, next_service_mileage numeric, updated_at timestamptz,
      ${checks[0].definition}) ON COMMIT DROP;
      CREATE TEMP TABLE vehicle_service_plans(plan_id int PRIMARY KEY, vehicle_id int, service_code text, interval_days int, interval_km numeric,
       last_service_date date,last_service_mileage numeric,next_service_date date,next_service_mileage numeric,deferred_until date,defer_reason text,version int,updated_at timestamptz,updated_by int) ON COMMIT DROP;
      CREATE TEMP TABLE vehiclemaintenance(maintenance_id int PRIMARY KEY DEFAULT 124, vehicle_id int, status text, maintenance_type text, maintenance_date date,
        completed_date date, mileage_at_service numeric, deleted_at timestamptz, created_by int, repair_completed_by int, assigned_mechanic_id int,
        repair_started_at timestamptz, repair_completed_at timestamptz, priority text, manager_approved_by int, manager_approved_at timestamptz,
        completed_by int, completed_at timestamptz, remarks text, service_plan_id int,service_plan_version int,rejection_reason text, assigned_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE driverincidents(incident_id int, vehicle_id int, severity text, status text, deleted_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE trips(trip_id int, vehicle_id int, trip_status text, deleted_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE audit_logs(action text) ON COMMIT DROP;`);
    await h.client.query("SAVEPOINT fixture");
  }, 20000);
  beforeEach(async () => {
    h.fail = null; await h.client.query("ROLLBACK TO SAVEPOINT fixture");
    await h.client.query(`INSERT INTO vehicles(vehicle_id,vehicle_status,registration_expiry,mileage,service_interval_days,service_interval_km)
      VALUES(7,'Under Maintenance','2099-01-01',90000,30,5000),(3,'Available','2099-01-01',10000,30,5000);
      INSERT INTO vehicle_service_plans(plan_id,vehicle_id,service_code,interval_days,interval_km,version) VALUES(1,7,'routine',30,5000,1);
      INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status,maintenance_type,maintenance_date,mileage_at_service)
      VALUES(123,7,'Scheduled','Routine','2099-01-01',20000);`);
  });
  afterAll(async () => { try { await h.client?.query("ROLLBACK"); } finally { await h.client?.end(); } });
  const vehicle = async (id = 7) => (await h.client.query("SELECT vehicle_status,last_service_date::text,next_service_date::text,next_service_mileage FROM vehicles WHERE vehicle_id=$1", [id])).rows[0];
  it("completes only the linked brake task, audits its cycle, and freezes completion retries", async () => {
    await h.client.query(`INSERT INTO vehicle_service_plans(plan_id,vehicle_id,service_code,interval_days,version) VALUES(2,7,'brakes',90,1);
      UPDATE vehiclemaintenance SET service_plan_id=2,service_plan_version=1`);
    expect((await put({status:"Completed",completed_date:"2026-10-01"})).status).toBe(200);
    expect((await h.client.query("SELECT service_code,version,last_service_date::text FROM vehicle_service_plans ORDER BY plan_id")).rows).toEqual([
      {service_code:"routine",version:1,last_service_date:null},{service_code:"brakes",version:2,last_service_date:"2026-10-01"}]);
    expect((await vehicle()).next_service_date).toBeNull();
    expect((await h.client.query("SELECT action FROM audit_logs ORDER BY action")).rows).toEqual([{action:"maintenance_completed"},{action:"service_plan_completed"}]);
    expect((await put({status:"Completed"})).status).toBe(409);
  });
  it("rolls a changed linked cycle back and permits retry when the reviewed version is restored", async () => {
    await h.client.query("UPDATE vehiclemaintenance SET service_plan_id=1,service_plan_version=2");
    expect((await put({status:"Completed"})).status).toBe(500);
    expect((await h.client.query("SELECT status FROM vehiclemaintenance")).rows[0].status).toBe("Scheduled");
    await h.client.query("UPDATE vehiclemaintenance SET service_plan_version=1");
    expect((await put({status:"Completed"})).status).toBe(200);
  });
  it("rolls linked completion, plan version and routine mirror back if required audit fails", async () => {
    await h.client.query("UPDATE vehiclemaintenance SET service_plan_id=1,service_plan_version=1"); h.fail="audit";
    expect((await put({status:"Completed"})).status).toBe(500);
    expect((await h.client.query("SELECT version,last_service_date FROM vehicle_service_plans")).rows[0]).toEqual({version:1,last_service_date:null});
    expect((await h.client.query("SELECT status FROM vehiclemaintenance")).rows[0].status).toBe("Scheduled");
    expect((await vehicle()).next_service_date).toBeNull();
  });
  it("does not advance a linked plan on rejection, cancellation or archive", async () => {
    await h.client.query("UPDATE vehiclemaintenance SET service_plan_id=1,service_plan_version=1,status='Pending Inspection'");
    expect((await put({status:"In Progress",rejection_reason:"Needs rework"})).status).toBe(200);
    expect((await h.client.query("SELECT version FROM vehicle_service_plans")).rows[0].version).toBe(1);
    expect((await put({deleted_at:"2026-10-24"})).status).toBe(200);
    expect((await h.client.query("SELECT version FROM vehicle_service_plans")).rows[0].version).toBe(1);
  });
  it("commits Routine completion, actual service date, odometer baseline, status and audit together", async () => {
    const response = await put({ status: "Completed", completed_date: "2026-10-01" }); expect(response.status).toBe(200);
    expect(await vehicle()).toEqual({ vehicle_status: "Available", last_service_date: "2026-10-01", next_service_date: "2026-10-31", next_service_mileage: "25000" });
    expect((await h.client.query("SELECT action FROM audit_logs")).rows).toEqual([{ action: "maintenance_completed" }]);
  });
  it.each(["Corrective", "Inspection"])("does not reset the Routine schedule for completed %s work", async (type) => {
    await h.client.query("UPDATE vehiclemaintenance SET maintenance_type=$1", [type]);
    expect((await put({ status: "Completed", completed_date: "2026-10-01" })).status).toBe(200);
    expect(await vehicle()).toMatchObject({ last_service_date: null, next_service_date: null, next_service_mileage: null });
  });
  it.each([undefined, null, ""])("server stamps the Manila completion day for missing actual date %s", async (completed_date) => {
    const today = (await h.client.query("SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date::text AS day")).rows[0].day;
    expect((await put({ status: "Completed", completed_date })).status).toBe(200);
    expect((await vehicle()).last_service_date).toBe(today);
  });
  it("preserves unknown service mileage instead of using the current vehicle odometer", async () => {
    await h.client.query("UPDATE vehiclemaintenance SET mileage_at_service=NULL");
    expect((await put({ status: "Completed", completed_date: "2026-10-01" })).status).toBe(200);
    expect((await vehicle()).next_service_mileage).toBeNull();
  });
  it.each(["schedule", "status"])("rolls the completion, stamps, schedule, status and audit back on %s failure", async (failure) => {
    h.fail = failure; expect((await put({ status: "Completed", completed_date: "2026-10-01" })).status).toBe(500);
    expect((await h.client.query("SELECT status,completed_date,completed_by,completed_at FROM vehiclemaintenance WHERE maintenance_id=123")).rows[0]).toEqual({ status: "Scheduled", completed_date: null, completed_by: null, completed_at: null });
    expect(await vehicle()).toEqual({ vehicle_status: "Under Maintenance", last_service_date: null, next_service_date: null, next_service_mileage: null });
    expect((await h.client.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(0);
  });
  it("releases the old vehicle and grounds the new vehicle on active-work reassignment", async () => {
    await h.client.query("UPDATE vehiclemaintenance SET status='In Progress'");
    expect((await put({ vehicle_id: 3 })).status).toBe(200);
    expect((await vehicle()).vehicle_status).toBe("Available"); expect((await vehicle(3)).vehicle_status).toBe("Under Maintenance");
  });
  it("keeps a remaining active repair and an open major incident grounded", async () => {
    await h.client.query("INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status) VALUES(125,7,'In Progress')");
    expect((await put({ status: "Completed" })).status).toBe(200); expect((await vehicle()).vehicle_status).toBe("Under Maintenance");
    await h.client.query("UPDATE vehiclemaintenance SET status='Completed'; INSERT INTO driverincidents VALUES(1,7,'Major','Open',NULL)");
    await syncVehicleStatus(7, h.client); expect((await vehicle()).vehicle_status).toBe("Under Maintenance");
  });
  it("accepts Registration Expired under the actual live constraint and preserves the expiry day itself", async () => {
    await h.client.query("UPDATE vehiclemaintenance SET status='Completed'; UPDATE vehicles SET registration_expiry=(NOW() AT TIME ZONE 'Asia/Manila')::date-1 WHERE vehicle_id=7");
    await syncVehicleStatus(7, h.client); expect((await vehicle()).vehicle_status).toBe("Registration Expired");
    await h.client.query("UPDATE vehicles SET registration_expiry=(NOW() AT TIME ZONE 'Asia/Manila')::date WHERE vehicle_id=7");
    await syncVehicleStatus(7, h.client); expect((await vehicle()).vehicle_status).toBe("Available");
  });
  it("does not ground a future Scheduled order but does ground one due today in Manila", async () => {
    await syncVehicleStatus(7, h.client); expect((await vehicle()).vehicle_status).toBe("Available");
    await h.client.query("UPDATE vehiclemaintenance SET maintenance_date=(NOW() AT TIME ZONE 'Asia/Manila')::date");
    await syncVehicleStatus(7, h.client); expect((await vehicle()).vehicle_status).toBe("Under Maintenance");
  });
  it("forces POST to Scheduled and grounds a due order within creation", async () => {
    const response = await POST({ body: { vehicle_id: 3, maintenance_date: "2026-10-01", maintenance_type: "Routine", status: "Completed", completed_date: "2026-10-01" } });
    expect(response.status).toBe(201); expect((await response.json()).status).toBe("Scheduled");
    expect((await vehicle(3)).vehicle_status).toBe("Under Maintenance"); expect((await vehicle(3)).last_service_date).toBeNull();
  });
});
