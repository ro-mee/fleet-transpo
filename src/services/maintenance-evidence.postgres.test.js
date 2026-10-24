import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import pg from "pg";
import { loadEnvLocal } from "../../scripts/load-env.mjs";
const h=vi.hoisted(()=>({client:null}));
vi.mock("@/lib/db",()=>({query:async(...args)=>h.client.query(...args),withTransaction:async run=>{await h.client.query("SAVEPOINT request");try{const r=await run(h.client);await h.client.query("RELEASE SAVEPOINT request");return r;}catch(e){await h.client.query("ROLLBACK TO SAVEPOINT request");throw e;}}}));
import { ensureInspectionMaintenance } from "@/lib/inspections/maintenance";
import { appendMaintenanceSnapshot,captureServiceCompletion,captureOdometerCrossings,maintenanceSnapshots,inspectionSignalsForVehicles } from "./maintenance-evidence.service";
const session={user:{employeeId:8,role:"fleet_manager"}};
describe.skipIf(process.env.MAINTENANCE_FIXTURE_DB_TEST!=="1")("inspection/evidence rollback TEMP SQL",()=>{
 beforeAll(async()=>{loadEnvLocal();h.client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await h.client.connect();await h.client.query("BEGIN; SET LOCAL search_path TO pg_temp,pg_catalog; SET LOCAL statement_timeout='8s'");
 await h.client.query(`CREATE TEMP TABLE vehicles(vehicle_id int primary key,plate_number text);
 CREATE TEMP TABLE vehicleinspection(inspection_id int primary key,vehicle_id int,inspection_type text,inspection_date date,findings text,severity text,checklist jsonb);
 CREATE TEMP TABLE vehiclemaintenance(maintenance_id int primary key DEFAULT 100,vehicle_id int,maintenance_type text,maintenance_date date,description text,cost numeric,status text,priority text,remarks text,created_by int,source_inspection_id int unique,inspection_items jsonb DEFAULT '[]',inspection_outcomes jsonb DEFAULT '[]',deleted_at timestamptz,completed_date date,completed_at timestamptz,assigned_mechanic_id int,service_plan_id int);
 CREATE TEMP TABLE maintenance_forecast_snapshots(snapshot_id int GENERATED ALWAYS AS IDENTITY,vehicle_id int,service_plan_id int,maintenance_id int,rule_version text,event text,inputs jsonb,forecast jsonb,outcome jsonb,captured_by int,captured_at timestamptz DEFAULT clock_timestamp());
 INSERT INTO vehicles VALUES(7,'TEMP');`);await h.client.query("SAVEPOINT fixture");
 });
 beforeEach(async()=>{await h.client.query("ROLLBACK TO SAVEPOINT fixture");await h.client.query(`INSERT INTO vehicleinspection VALUES(1,7,'Pre-Shift','2026-10-01',NULL,'High','[{"item_id":"brakes_tires","status":"FAIL"}]'),(2,7,'Pre-Shift','2026-10-24',NULL,'High','[{"item_id":"brakes_tires","status":"FAIL"},{"item_id":"lights","status":"FAIL"}]');`);});
 afterAll(async()=>{try{await h.client?.query("ROLLBACK");}finally{await h.client?.end();}});
 const snapshot=()=>appendMaintenanceSnapshot(h.client,{event:"reviewed_schedule",order:{vehicle_id:7,maintenance_id:9,service_plan_id:1},forecast:{next_service_mileage:1000},actorId:8});
 it("verifies live evidence security/immutability without writing public rows",async()=>{
  const catalog=(await h.client.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.maintenance_forecast_snapshots'::regclass")).rows[0];
  expect(catalog.relrowsecurity).toBe(true);
  const grants=(await h.client.query("SELECT grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='maintenance_forecast_snapshots' AND grantee IN ('anon','authenticated')")).rows;
  expect(grants).toEqual([]);
  expect((await h.client.query("SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='maintenance_forecast_snapshots'")).rows).toEqual([]);
  await h.client.query("CREATE TRIGGER immutable_fixture BEFORE UPDATE OR DELETE ON maintenance_forecast_snapshots FOR EACH ROW EXECUTE FUNCTION public.maintenance_forecast_immutable()");
  await snapshot();await h.client.query("SAVEPOINT immutable");
  await expect(h.client.query("UPDATE maintenance_forecast_snapshots SET event='completed'")).rejects.toThrow(/immutable/);
  await h.client.query("ROLLBACK TO SAVEPOINT immutable");
  await expect(h.client.query("DELETE FROM maintenance_forecast_snapshots")).rejects.toThrow(/immutable/);
  await h.client.query("ROLLBACK TO SAVEPOINT immutable");
 });
 it("reuses active canonical work across newer source inspections and preserves each item's sources",async()=>{
  await h.client.query(`INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status,source_inspection_id) VALUES(9,7,'Scheduled',1)`);
  const r=await ensureInspectionMaintenance({inspectionId:2,session,allowChecklistType:true,checklistItemId:"brakes_tires"});
  expect(r.created).toBe(false);expect(r.workOrder.maintenance_id).toBe(9);
  expect(r.workOrder.inspection_items).toEqual([{checklist_item_id:"brakes_tires",inspection_ids:[1,2]}]);
  expect((await h.client.query("SELECT count(*)::int n FROM vehiclemaintenance")).rows[0].n).toBe(1);
 });
 it("targets only the new item and honestly recovers each item across mixed-source retries",async()=>{
  await h.client.query("INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status,source_inspection_id) VALUES(9,7,'Scheduled',1)");
  const lights=await ensureInspectionMaintenance({inspectionId:2,session,allowChecklistType:true,checklistItemId:"lights"});
  expect(lights.workOrder.inspection_items).toEqual([{checklist_item_id:"lights",inspection_ids:[2]}]);
  const brakes=await ensureInspectionMaintenance({inspectionId:2,session,allowChecklistType:true,checklistItemId:"brakes_tires"});
  expect(brakes.workOrder.maintenance_id).toBe(9);
  expect((await ensureInspectionMaintenance({inspectionId:2,session,allowChecklistType:true,checklistItemId:"lights"})).workOrder.maintenance_id).toBe(lights.workOrder.maintenance_id);
  await h.client.query(`UPDATE vehicleinspection SET checklist=checklist || '[{"item_id":"dashboard","status":"FAIL"}]'::jsonb WHERE inspection_id=2`);
  const added=await ensureInspectionMaintenance({inspectionId:2,session,allowChecklistType:true,checklistItemId:"dashboard"});
  expect(added.workOrder.maintenance_id).toBe(lights.workOrder.maintenance_id);
  expect(added.workOrder.inspection_items).toEqual([{checklist_item_id:"dashboard",inspection_ids:[2]},{checklist_item_id:"lights",inspection_ids:[2]}]);
  const orders=(await h.client.query("SELECT inspection_items FROM vehiclemaintenance")).rows;
  expect(orders.filter(o=>o.inspection_items.some(i=>i.checklist_item_id==="brakes_tires"))).toHaveLength(1);
 });
 it("does not overwrite a multi-item generic original order when attaching newer item evidence",async()=>{
  await h.client.query("UPDATE vehicleinspection SET checklist=(SELECT checklist FROM vehicleinspection WHERE inspection_id=2) WHERE inspection_id=1");
  await h.client.query(`INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status,source_inspection_id) VALUES(9,7,'Scheduled',1)`);
  const r=await ensureInspectionMaintenance({inspectionId:2,session,allowChecklistType:true,checklistItemId:"brakes_tires"});
  expect(r.workOrder.inspection_items).toEqual([{checklist_item_id:"brakes_tires",inspection_ids:[1,2]},{checklist_item_id:"lights",inspection_ids:[1]}]);
 });
 it("captures scheduling and completion atomically, labels early service, and leaves empty/foreign reads truthful",async()=>{
  await h.client.query("INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status,assigned_mechanic_id,service_plan_id) VALUES(9,7,'Scheduled',5,1)");
  await h.client.query("SAVEPOINT lifecycle");await snapshot();await captureServiceCompletion(h.client,{maintenance_id:9,vehicle_id:7,service_plan_id:1,mileage_at_service:900},8);
  expect((await maintenanceSnapshots({role:"mechanic",employeeId:5},9,h.client)).map(s=>s.event)).toEqual(["reviewed_schedule","completed"]);
  expect((await maintenanceSnapshots({role:"mechanic",employeeId:6},9,h.client))).toEqual([]);
  expect((await maintenanceSnapshots(session.user,999,h.client))).toEqual([]);
  expect((await h.client.query("SELECT outcome FROM maintenance_forecast_snapshots WHERE event='completed'")).rows[0].outcome.evaluation).toBe("early_service");
  await h.client.query("ROLLBACK TO SAVEPOINT lifecycle");expect((await maintenanceSnapshots(session.user,9,h.client))).toEqual([]);
 });
 it("records observed crossings once and refuses backdated observations before the forecast",async()=>{
  await h.client.query("INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status,assigned_mechanic_id,service_plan_id) VALUES(9,7,'Scheduled',5,1)");await snapshot();
  const observation={vehicle_id:7,observation_id:1,reading_km:1100,observed_at:"2020-01-01T00:00:00Z"};
  await captureOdometerCrossings(h.client,observation,900,8);
  expect((await maintenanceSnapshots(session.user,9,h.client))).toHaveLength(1);
  observation.observed_at=new Date(Date.now()+1000).toISOString();
  await captureOdometerCrossings(h.client,observation,900,8);await captureOdometerCrossings(h.client,observation,900,8);
  expect((await maintenanceSnapshots(session.user,9,h.client))).toHaveLength(2);
 });
 it("recognizes active legacy item work even when its original source is older than the recurrence window",async()=>{
  await h.client.query(`INSERT INTO vehicleinspection VALUES(0,7,'Pre-Shift','2026-09-01',NULL,'High','[{"item_id":"brakes_tires","status":"FAIL"}]');
  INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status,assigned_mechanic_id,source_inspection_id) VALUES(9,7,'Scheduled',5,0)`);
  const signals=await inspectionSignalsForVehicles(h.client,[7],session.user,new Date("2026-10-24"));
  expect(signals.get(7)[0]).toMatchObject({count:2,review_disposition:"work_order_active",active_work_order:{maintenance_id:9}});
 });
 it("read-only signal computation neither adds snapshots nor exposes another mechanic's sources",async()=>{
  await h.client.query(`INSERT INTO vehiclemaintenance(maintenance_id,vehicle_id,status,assigned_mechanic_id,inspection_items) VALUES(9,7,'Scheduled',5,'[{"checklist_item_id":"brakes_tires","inspection_ids":[1]}]')`);
  const own=await inspectionSignalsForVehicles(h.client,[7],{role:"mechanic",employeeId:5},new Date("2026-10-24"));
  expect(own.get(7)[0]).toMatchObject({count:2,checklist_item_id:"brakes_tires"});
  expect((await inspectionSignalsForVehicles(h.client,[7],{role:"mechanic",employeeId:6},new Date("2026-10-24"))).get(7)).toEqual([]);
  expect((await h.client.query("SELECT count(*)::int n FROM maintenance_forecast_snapshots")).rows[0].n).toBe(0);
 });
});
