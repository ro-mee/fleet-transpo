import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { loadEnvLocal } from "../../scripts/load-env.mjs";
const state = vi.hoisted(() => ({ client: null, user: { role: "fleet_manager", employeeId: 9 } }));
vi.mock("@/lib/db", () => ({ query: (...args) => state.client.query(...args) }));
vi.mock("@/lib/api/utils", async importOriginal => ({
  ...await importOriginal(),
  requirePermission: vi.fn(async () => ({ user: state.user })),
  ok: data => Response.json({ data }),
  handleError: error => { throw error; },
}));
import { reviewPlanWorkOrder } from "./maintenance-plan-workorders.service";
import { GET } from "../app/api/ai/predictive-maintenance/route";
let client;
const predictions = async () => (await (await GET(new Request("http://localhost/api/ai/predictive-maintenance"))).json()).data;
describe.skipIf(process.env.MAINTENANCE_FIXTURE_DB_TEST !== "1")("maintenance outlook actual SQL, temporary fixtures only", () => {
  beforeAll(async () => {
    loadEnvLocal();
    client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    await client.connect(); state.client = client;
    await client.query("BEGIN; SET LOCAL search_path TO pg_temp,pg_catalog; SET LOCAL statement_timeout='8s'");
    await client.query(`CREATE TEMP TABLE vehicles(vehicle_id int PRIMARY KEY,plate_number text,vehicle_name text,mileage numeric,next_service_date date,next_service_mileage numeric,last_service_date date,deleted_at timestamptz,vehicle_status text,updated_at timestamptz);
      CREATE TEMP TABLE trips(trip_id int,vehicle_id int,trip_status text,deleted_at timestamptz,start_time timestamptz,end_time timestamptz,start_odometer numeric,end_odometer numeric,distance numeric,actual_distance_km numeric,distance_provenance text);
      CREATE TEMP TABLE vehiclemaintenance(maintenance_id int,vehicle_id int,assigned_mechanic_id int,deleted_at timestamptz,status text,maintenance_type text,maintenance_date date,service_plan_id int,service_plan_version int,CHECK ((service_plan_id IS NULL) = (service_plan_version IS NULL)));
      CREATE TEMP TABLE vehicle_service_plans(plan_id int PRIMARY KEY,vehicle_id int,service_code text,next_service_date date,next_service_mileage numeric,last_service_date date,last_service_mileage numeric,interval_days int,interval_km numeric,version int,deferred_until date,defer_reason text,UNIQUE(plan_id,vehicle_id));
      CREATE TEMP TABLE vehicle_odometer_observations(vehicle_id int,reading_km numeric,observed_at timestamptz,recorded_at timestamptz);
      CREATE TEMP TABLE trip_odometer_captures(trip_id int,vehicle_id int,stage text,state text,reading_km numeric,committed_at timestamptz);
      ALTER TABLE vehiclemaintenance ADD FOREIGN KEY(service_plan_id,vehicle_id) REFERENCES vehicle_service_plans(plan_id,vehicle_id);
      SAVEPOINT fixture`);
    const indexes=(await client.query(`SELECT pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i
      WHERE i.indrelid='public.vehiclemaintenance'::regclass AND i.indisunique AND pg_get_indexdef(i.indexrelid) LIKE '%(service_plan_id)%'`)).rows;
    expect(indexes).toHaveLength(1);
    await client.query(`CREATE UNIQUE INDEX fixture_active_service_plan ON vehiclemaintenance(service_plan_id) WHERE ${indexes[0].predicate}`);
    await client.query("RELEASE SAVEPOINT fixture; SAVEPOINT fixture");
  });
  afterAll(async () => { try { await client?.query("ROLLBACK"); } finally { await client?.end(); } });
  beforeEach(async () => {
    state.user = { role: "fleet_manager", employeeId: 9 };
    await client.query(`ROLLBACK TO SAVEPOINT fixture;
      INSERT INTO vehicles VALUES(7,'TEST-7','Test',1000,CURRENT_DATE+30,2000,NULL,NULL,'Available',NOW()),(8,'TEST-8','Other',500,NULL,NULL,NULL,NULL,'Available',NOW());
      INSERT INTO vehicle_service_plans(plan_id,vehicle_id,service_code,next_service_date,version) VALUES(10,7,'routine',CURRENT_DATE+30,1)`);
  });
  it("runs the actual staff and mechanic queries against the live schema without operating writes", async () => {
    await client.query("SET LOCAL search_path TO public,pg_catalog");
    try {
      const result = await predictions();
      expect(result.summary.total).toBe(result.predictions.length);
      expect(result.predictions.every(p => Array.isArray(p.services))).toBe(true);
      state.user = { role: "mechanic", employeeId: -1 };
      expect((await predictions()).predictions).toEqual([]);
    } finally { await client.query("SET LOCAL search_path TO pg_temp,pg_catalog"); }
  });
  it("uses real review SQL, current server evidence, same-vehicle FK and live active-index predicate", async () => {
    const commands=[];
    const tx={query:(sql,values)=>{commands.push(sql);return client.query(sql,values);}};
    const request={vehicle_id:7,service_plan_id:10,expected_version:1,forecast:{risk:"made up"}};
    const review=await reviewPlanWorkOrder(tx,state.user,request);
    expect(review.plan.plan_id).toBe(10); expect(review.existing).toBeNull();
    expect(review.reviewedService).toMatchObject({vehicle_id:7,plan_id:10,version:1});
    expect(review.reviewedService.risk).not.toBe("made up");
    const locks=commands.filter(sql=>sql.includes("FOR UPDATE"));
    expect(locks[0]).toContain("FROM vehicles"); expect(locks[1]).toContain("FROM vehicle_service_plans"); expect(locks[2]).toContain("FROM vehiclemaintenance");
    await client.query("INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,service_plan_id,service_plan_version,status) VALUES(55,7,10,1,'Scheduled')");
    expect((await reviewPlanWorkOrder(tx,state.user,request)).existing.maintenance_id).toBe(55);
    await client.query("SAVEPOINT invalid");
    await expect(client.query("INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,service_plan_id,service_plan_version,status) VALUES(56,7,10,1,'In Progress')")).rejects.toMatchObject({code:"23505"});
    await client.query("ROLLBACK TO SAVEPOINT invalid");
    await expect(client.query("INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,service_plan_id,service_plan_version,status) VALUES(56,8,10,1,'Completed')")).rejects.toMatchObject({code:"23503"});
    await client.query("ROLLBACK TO SAVEPOINT invalid");
    await expect(reviewPlanWorkOrder(tx,state.user,{...request,expected_version:2})).rejects.toMatchObject({status:409});
    await client.query("UPDATE vehiclemaintenance SET status='Cancelled'");
    expect((await reviewPlanWorkOrder(tx,state.user,request)).existing).toBeNull();
  });
  it("links only the current active order while retaining factual overdue and deferral", async () => {
    await client.query(`UPDATE vehicle_service_plans SET next_service_date=CURRENT_DATE-5,deferred_until=CURRENT_DATE+10,defer_reason='Awaiting parts';
      INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,service_plan_id,service_plan_version,status,maintenance_date) VALUES(55,7,10,1,'Scheduled',CURRENT_DATE+1)`);
    const service=(await predictions()).predictions.find(p => p.vehicle_id===7).services[0];
    expect(service.active_work_order).toMatchObject({maintenance_id:55,status:"Scheduled",service_plan_version:1});
    expect(service.serviceStatus).toBe("overdue"); expect(service.deferral_reason).toBe("Awaiting parts");
    await client.query("UPDATE vehiclemaintenance SET status='Completed'");
    expect((await predictions()).predictions.find(p => p.vehicle_id===7).services[0].active_work_order).toBeNull();
  });
  it("identifies the summarized task and hides another mechanic's active-order link", async () => {
    await client.query(`UPDATE vehicle_service_plans SET next_service_date=CURRENT_DATE-5;
      INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,assigned_mechanic_id,status,service_plan_id,service_plan_version) VALUES(1,7,99,'Scheduled',10,1),(2,7,9,'Completed',NULL,NULL)`);
    let p=(await predictions()).predictions.find(p=>p.vehicle_id===7);
    expect(p.primary_service_plan_id).toBe(10);
    state.user={role:"mechanic",employeeId:9}; p=(await predictions()).predictions[0];
    expect(p.services[0].active_work_order).toBeNull();
  });
  it("excludes unproven/estimated-only distance and reports incomplete coverage", async () => {
    await client.query(`INSERT INTO trips(trip_id,vehicle_id,trip_status,start_time,end_time,distance,actual_distance_km,distance_provenance)
      SELECT n,7,'Completed',NOW()-INTERVAL '14 days',NOW()-INTERVAL '1 day',100,CASE WHEN n=1 THEN 100 END,CASE WHEN n=1 THEN 'trip-distance' END FROM generate_series(1,5)n`);
    const p = (await predictions()).predictions[0];
    expect(p.evidence).toMatchObject({ validSampleCount: 1, totalSampleCount: 5, measuredKm: 100, quality: "limited", kmPerDay: null });
    expect(p.dataIssues).toContain("incomplete_distance_coverage");
  });
  it("accepts explicit actual sources and legacy measured odometer deltas with idle calendar days", async () => {
    await client.query(`INSERT INTO trips(trip_id,vehicle_id,trip_status,start_time,end_time,start_odometer,end_odometer,distance,actual_distance_km,distance_provenance) VALUES
      (1,7,'Completed',NULL,NOW()-INTERVAL '1 day',NULL,NULL,9999,100,'trip-distance'),
      (2,7,'Completed',NOW()-INTERVAL '14 days',NOW()-INTERVAL '13 days',100,200,9999,100,'odometer'),
      (3,7,'Completed',NOW()-INTERVAL '12 days',NOW()-INTERVAL '11 days',NULL,NULL,9999,100,'gps-trail'),
      (4,7,'Completed',NOW()-INTERVAL '10 days',NOW()-INTERVAL '9 days',300,400,9999,NULL,NULL),
      (5,7,'Completed',NOW()-INTERVAL '8 days',NOW()-INTERVAL '7 days',NULL,NULL,9999,100,'trip-distance')`);
    // A missing start timestamp cannot claim calendar coverage for that sample.
    let p = (await predictions()).predictions[0];
    expect(p.evidence.validSampleCount).toBe(4);
    expect(p.confidence).toBe("low");
    await client.query("UPDATE trips SET start_time=NOW()-INTERVAL '14 days' WHERE trip_id=1");
    p = (await predictions()).predictions[0];
    expect(p.evidence).toMatchObject({ validSampleCount: 5, totalSampleCount: 5, measuredKm: 500, quality: "sufficient" });
    expect(p.evidence.observationPeriod.calendarDays).toBeCloseTo(14, 2);
    expect(p.kmPerDay).toBeCloseTo(500/14, 2);
  });
  it("counts gaps and distance over the same observation period", async () => {
    await client.query(`INSERT INTO trips(trip_id,vehicle_id,trip_status,start_time,end_time,distance,actual_distance_km,distance_provenance) VALUES
      (1,7,'Completed',NOW()-INTERVAL '20 days',NOW()-INTERVAL '19 days',100,NULL,NULL),
      (2,7,'Completed',NOW()-INTERVAL '10 days',NOW()-INTERVAL '9 days',100,100,'gps-trail')`);
    const p = (await predictions()).predictions[0];
    expect(p.evidence.observationPeriod.calendarDays).toBeCloseTo(20,2);
    expect(p.evidence).toMatchObject({ totalSampleCount: 2, validSampleCount: 1, measuredKm: 100, quality: "limited" });
  });
  it("rejects negative or implausible odometer samples and future completions", async () => {
    await client.query(`INSERT INTO trips(trip_id,vehicle_id,trip_status,start_time,end_time,start_odometer,end_odometer,distance,actual_distance_km,distance_provenance) VALUES
      (1,7,'Completed',NOW()-INTERVAL '14 days',NOW()-INTERVAL '1 day',-100,100,200,200,'odometer'),
      (2,7,'Completed',NOW()-INTERVAL '14 days',NOW()-INTERVAL '1 day',100,99,200,NULL,NULL),
      (3,7,'Completed',NOW()-INTERVAL '14 days',NOW()-INTERVAL '1 day',100,2000001,200,NULL,NULL),
      (4,7,'Completed',NOW()-INTERVAL '14 days',NOW()+INTERVAL '1 day',100,200,100,100,'odometer')`);
    const p = (await predictions()).predictions[0];
    expect(p.evidence).toMatchObject({ validSampleCount: 0, totalSampleCount: 3, measuredKm: 0, quality: "limited" });
    expect(p.evidence.latestReadingAt).toBeNull();
  });
  it("attributes the current odometer to a manual observation without photo verification", async () => {
    await client.query(`INSERT INTO vehicle_odometer_observations(vehicle_id,reading_km,observed_at,recorded_at) VALUES(7,1000,NOW()-INTERVAL '2 days',NOW()),(7,999,NOW()-INTERVAL '1 day',NOW())`);
    const p = (await predictions()).predictions[0];
    expect(p.evidence).toMatchObject({ latestReadingSource: "manual_observation", photoVerified: false });
    expect(p.evidence.latestReadingAt).not.toBeNull();
  });
  it("attributes committed matching photo readings and ignores uncommitted or mismatched captures", async () => {
    await client.query(`INSERT INTO trips(trip_id,vehicle_id,trip_status,start_time,end_time,start_odometer,end_odometer) VALUES(1,7,'Completed',NOW()-INTERVAL '14 days',NOW()-INTERVAL '1 day',900,1000);
      INSERT INTO trip_odometer_captures(trip_id,vehicle_id,stage,state,reading_km,committed_at) VALUES(1,7,'end','committed',1000,NOW()-INTERVAL '1 day')`);
    const p = (await predictions()).predictions[0];
    expect(p.evidence).toMatchObject({ latestReadingSource: "trip_odometer_photo", photoVerified: true });
    await client.query("UPDATE trip_odometer_captures SET vehicle_id=8");
    expect((await predictions()).predictions[0].evidence).toMatchObject({ latestReadingSource: "trip_odometer", photoVerified: false });
  });
  it("retains date-only plans, independent urgency and mechanic assignment scope", async () => {
    await client.query(`INSERT INTO vehicle_service_plans(plan_id,vehicle_id,service_code,next_service_mileage,version) VALUES(11,7,'brakes',999,2);
      INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,assigned_mechanic_id) VALUES(1,7,9),(2,8,10)`);
    state.user = { role: "mechanic", employeeId: 9 };
    const result = await predictions();
    expect(result.predictions).toHaveLength(1);
    expect(result.predictions[0]).toMatchObject({ vehicle_id: 7, risk: "overdue", next_service_mileage: 999 });
    expect(result.predictions[0].services).toHaveLength(2);
    await client.query("UPDATE vehiclemaintenance SET deleted_at=NOW() WHERE assigned_mechanic_id=9");
    expect((await predictions()).predictions).toEqual([]);
  });
});
