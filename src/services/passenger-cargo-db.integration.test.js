import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {loadEnvLocal} from '../../scripts/load-env.mjs';

const connection=vi.hoisted(()=>({client:null,pending:Promise.resolve(),
 query(sql,values=[]){const next=this.pending.then(()=>this.client.query(sql,values));this.pending=next.catch(()=>{});return next;},
}));
// The only replacement is the database connection: every service SQL statement
// executes unchanged on the same real PostgreSQL session and temp schema.
vi.mock('@/lib/db',async importOriginal=>({
 ...await importOriginal(),
 query:(sql,values=[])=>{
  if (!connection.client) throw new Error('Isolated review connection is not initialized.');
  if (/\bpublic\s*\./i.test(sql)) throw new Error('Production-qualified SQL is forbidden in isolated review fixtures.');
  return connection.query(sql,values);
 },
 withTransaction:fn=>fn({query:(sql,values=[])=>connection.query(sql,values)}),
 getAdminClient:()=>({from(table){
  if(!/^[a-z_]+$/.test(table)) throw new Error('Invalid temp table identifier.');
  let columns='*',changes=null,single=false,limit=null;const filters=[],values=[];
  const builder={select(value){columns=value;return this;},update(value){changes=value;return this;},
   eq(column,value){values.push(value);filters.push(`${column}=$${values.length}`);return this;},
   in(column,value){values.push(value);filters.push(`${column}=ANY($${values.length})`);return this;},
   is(column,value){if(value!==null)throw new Error('Only null is supported.');filters.push(`${column} IS NULL`);return this;},
   limit(value){limit=Number(value);return this;},maybeSingle(){single=true;return this;},
   then(resolve,reject){
    let sql;
    if(changes){const sets=Object.entries(changes).map(([column,value])=>{values.push(value);return `${column}=$${values.length}`;});sql=`UPDATE ${table} SET ${sets.join(',')}`;}
    else sql=`SELECT ${columns} FROM ${table}`;
    if(filters.length)sql+=` WHERE ${filters.join(' AND ')}`;
    if(limit!=null)sql+=` LIMIT ${limit}`;
    return connection.query(sql,values).then(result=>({data:single?result.rows[0]??null:result.rows,error:null})).then(resolve,reject);
   }};return builder;
 }}),
}));
vi.mock('@/lib/api/utils',async importOriginal=>({...await importOriginal(),requirePermission:vi.fn(async()=>({user:{employeeId:8,role:'admin'}}))}));
import {PUT as assignRequest} from '@/app/api/integration/transport-requests/[id]/assign/route';
import {POST as createDispatch} from '@/app/api/dispatch/route';
import {PUT as editDispatch} from '@/app/api/dispatch/[id]/route';
import {PUT as startTrip} from '@/app/api/trips/[id]/start/route';
import {itemsForType} from '@/lib/inspections/checklists';
vi.mock('@/lib/tomtom',async importOriginal=>({...await importOriginal(),fetchTomTomRoute:vi.fn(async()=>({durationMin:5,distanceKm:1,trafficDelayMin:0}))}));
import {getPool} from '@/lib/db';
import {validatePairAvailability} from './recommendation.service';
import {commitDispatchEvidence} from './dispatch-evidence.service';

const enabled=process.env.FLEETOPS_REVIEW_DB_TEST==='1';
describe.skipIf(!enabled)('real PostgreSQL passenger/cargo review evidence in isolated temporary tables',()=>{
 let pool,pickup;
 beforeAll(async()=>{
  if (!process.env.DATABASE_URL) loadEnvLocal(['.env.local','.env','../../.env.local','../../.env']);
  pool=getPool();
  connection.client=await pool.connect();
  await connection.client.query('BEGIN');
  await connection.client.query('SET LOCAL statement_timeout = 15000');
  // Clone every public table without defaults, triggers, foreign keys or indexes.
  // Explicit IDs avoid advancing any production sequence. No public rows change.
  const {rows}=await connection.client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  for (const {tablename} of rows) {
   if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error('Unsupported table identifier in fixture catalog.');
   await connection.client.query(`CREATE TEMP TABLE "${tablename}" (LIKE public."${tablename}" INCLUDING CONSTRAINTS) ON COMMIT DROP`);
  }
  await connection.client.query('SET LOCAL search_path = pg_temp, public');
  // Give audit/event writers local identities, never a public sequence default.
  await connection.client.query("CREATE TEMP SEQUENCE review_audit_seq START 10000");
  await connection.client.query("ALTER TABLE pg_temp.audit_logs ALTER COLUMN log_id SET DEFAULT nextval('pg_temp.review_audit_seq')");
  await connection.client.query("CREATE UNIQUE INDEX review_audit_event ON pg_temp.audit_logs(event_key) WHERE event_key IS NOT NULL");
  await connection.client.query("CREATE TEMP SEQUENCE review_event_seq START 10000");
  await connection.client.query("ALTER TABLE pg_temp.reservation_events ALTER COLUMN event_id SET DEFAULT nextval('pg_temp.review_event_seq')");
  await connection.client.query("ALTER TABLE pg_temp.reservation_events ALTER COLUMN occurred_at SET DEFAULT NOW()");

  const q=(sql,values=[])=>connection.client.query(sql,values);
  pickup=new Date(Date.now()+2*86400000);pickup.setUTCHours(2,0,0,0);
  const expiry=new Date(Date.now()+730*86400000).toISOString().slice(0,10);
  await q("INSERT INTO vehiclecategories(category_id,category_name,status) VALUES(1,'Review cargo','Active')");
  await q("INSERT INTO vehicles(vehicle_id,vehicle_name,plate_number,fleet_asset_code,category_id,required_license_class,operational_use,cargo_capacity_kg,commissioning_status,vehicle_status,fuel_level) VALUES(2,'Isolated review truck','REV5678','REVIEW-002',1,'B','Cargo',1000,'Pending','Available',90)");
  await q("INSERT INTO employees(employee_id,first_name,last_name,email,status,auth_version,must_change_password) VALUES(8,'Review','Driver','review@example.invalid','Active',1,false)");
  await q("INSERT INTO drivers(driver_id,employee_id,license_number,license_type,license_class,license_expiry,license_verified_at,license_verified_by,license_verification_method,driver_status,standby_tracking_enabled) VALUES(7,8,'N04-19-013583','Professional','B',$1,NOW()-INTERVAL '1 day',8,'physical_card','Available',false)",[expiry]);
  await q("INSERT INTO driver_vehicle_assignments(assignment_id,driver_id,vehicle_id,assigned_from,created_at,updated_at) VALUES(1,7,2,CURRENT_DATE,NOW(),NOW())");
  for(let day=0;day<7;day++) await q("INSERT INTO driver_work_schedules(schedule_id,driver_id,day_of_week,shift_start,shift_end,is_rest_day,created_at,updated_at) VALUES($1,7,$2,'00:00','23:59',false,NOW(),NOW())",[day+1,day]);
  await q("INSERT INTO locations(location_id,name,latitude,longitude,is_active,pickup_radius_m,dropoff_radius_m,location_code) VALUES(1,'Review pickup',14.5,121,true,100,100,'00000000-0000-4000-8000-000000000001'),(2,'Review dropoff',14.6,121.1,true,100,100,'00000000-0000-4000-8000-000000000002')");
  await q("INSERT INTO routes(route_id,route_name,origin,destination,origin_location_id,destination_location_id,estimated_distance,estimated_duration,estimate_source,status) VALUES(1,'Review route','Review pickup','Review dropoff',1,2,20,60,'Manual','Active')");
  await q("INSERT INTO transportation_requests(request_id,source_system,pickup_location,dropoff_location,pickup_location_id,dropoff_location_id,pickup_datetime,priority,fleet_status,is_vip,is_emergency,load_type,cargo_weight_kg,cargo_description,requested_category_id,estimated_distance,estimated_duration) VALUES(3,'POS','Review pickup','Review dropoff',1,2,$1,'Low','Pending',false,false,'Cargo',650,'Isolated review supplies',1,20,60)",[pickup]);
  await q("INSERT INTO system_settings(setting_key,setting_value) VALUES('uvvrp_policy',$1::jsonb)",[JSON.stringify({enabled:false})]);
  connection.expiry=expiry;
 },60000);
 afterAll(async()=>{
  if(connection.client){await connection.client.query('ROLLBACK');connection.client.release();connection.client=null;}
  if(pool){await pool.end();delete globalThis.postgresPool;}
 });
 it('blocks Pending/no-docs then accepts complete actual cargo evidence and commits only to temp request rows',async()=>{
  const check=(request={request_id:3},allowReview=false)=>validatePairAvailability({request,vehicleId:2,driverId:7,allowReview});
  const pending=await check({request_id:3},true);
  expect(pending).toMatchObject({ok:false,conflict:{type:'road_readiness',severity:'blocking'}});
  expect(pending.conflict.detail.blockers).toContain('COMMISSIONING_NOT_READY');
  await connection.client.query("UPDATE vehicles SET commissioning_status='Ready' WHERE vehicle_id=2");
  const noDocs=await check({request_id:3},true);
  expect(noDocs.ok).toBe(false);
  expect(noDocs.conflict.type).toBe('road_readiness');
  await connection.client.query("INSERT INTO vehicledocuments(document_id,vehicle_id,document_type,document_number,file_url,expiry_date,verification_status,verified_by,verified_at) VALUES(1,2,'OR_CR','REVIEW-OR','review://or',$1,'Verified',8,NOW()-INTERVAL '1 day'),(2,2,'Insurance','REVIEW-INS','review://insurance',$1,'Verified',8,NOW()-INTERVAL '1 day')",[connection.expiry]);
  const valid=await check({request_id:3,cargo_weight_kg:1});
  expect(valid.ok).toBe(true);
  expect(valid.evidence.readiness).toBe('VERIFIED');
  expect(valid.evidence.checks.every(c=>c.status==='verified')).toBe(true);
  expect((+new Date(valid.serviceEnd)-+pickup)/60000).toBe(150);
  expect((+new Date(valid.serviceEnd)-+pickup)/60000).toBeGreaterThanOrEqual(90);
  const deficient=await check({request_id:3,scheduled_arrival:new Date(+pickup+60*60000).toISOString()},true);
  expect(deficient).toMatchObject({ok:false,conflict:{type:'service_window',severity:'blocking'}});
  const equal=await check({request_id:3,scheduled_arrival:pickup.toISOString()},true);
  expect(equal).toMatchObject({ok:false,conflict:{type:'service_window',severity:'blocking'}});
  await commitDispatchEvidence(valid.commitToken,tx=>tx.query("UPDATE transportation_requests SET fleet_status='Assigned' WHERE request_id=3"));
  expect((await connection.client.query('SELECT fleet_status FROM transportation_requests WHERE request_id=3')).rows[0].fleet_status).toBe('Assigned');
  await connection.client.query("UPDATE transportation_requests SET cargo_weight_kg=1800 WHERE request_id=3");
  const overweight=await check({request_id:3,cargo_weight_kg:1},true);
  expect(overweight.conflict.message).toBe('Vehicle REV5678 cargo capacity 1000 kg, request needs 1800 kg (over by 800 kg).');
 },60000);
 it('returns the identical real overloaded-row blocker from assign, dispatch create/edit and trip start',async()=>{
  const request=(body)=>new Request('http://localhost/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const assigned=await assignRequest(request({vehicle_id:2,driver_id:7,force:true,override_reason:'Review source records'}),{params:Promise.resolve({id:'3'})});
  const created=await createDispatch(request({request_id:3,vehicle_id:2,driver_id:7,scheduled_departure:pickup.toISOString(),override_reason:'Review source records'}));
  const past=new Date(Date.now()-5*60000),end=new Date(+past+150*60000);
  await connection.query("INSERT INTO dispatchschedules(dispatch_id,dispatch_number,request_id,vehicle_id,driver_id,route_id,scheduled_departure,scheduled_arrival,status) VALUES(10,'REVIEW-10',3,2,7,1,$1,$2,'Scheduled')",[past,end]);
  const edited=await editDispatch(request({scheduled_departure:pickup.toISOString(),scheduled_arrival:new Date(+pickup+240*60000).toISOString(),override_reason:'Review source records'}),{params:Promise.resolve({id:'10'})});
  await connection.query("INSERT INTO trips(trip_id,dispatch_id,driver_id,vehicle_id,route_id,trip_status,at_pickup_override) VALUES(11,10,7,2,1,'Driver Accepted',false)");
  const checklist=itemsForType('Pre-Trip','Cargo').map(item_id=>({item_id}));
  await connection.query("INSERT INTO vehicleinspection(inspection_id,vehicle_id,driver_id,trip_id,inspection_type,inspection_date,status,checklist) VALUES(1,2,7,11,'Pre-Trip',CURRENT_DATE,'Passed',$1::jsonb)",[JSON.stringify(checklist)]);
  const started=await startTrip(request({}),{params:Promise.resolve({id:'11'})});
  const responses=[assigned,created,edited,started];
  expect(responses.map(r=>r.status)).toEqual([409,409,409,409]);
  const errors=await Promise.all(responses.map(async r=>(await r.json()).error));
  expect(errors).toEqual(Array(4).fill('Vehicle REV5678 cargo capacity 1000 kg, request needs 1800 kg (over by 800 kg).'));
  expect((await connection.query('SELECT trip_status FROM trips WHERE trip_id=11')).rows[0].trip_status).toBe('Driver Accepted');
 },60000);

 it('starts an actual preserved null-classified request without typed commissioning or verified documents',async()=>{
  const departure=new Date(Date.now()+30*60000),arrival=new Date(+departure+60*60000);
  await connection.query("UPDATE transportation_requests SET load_type=NULL,cargo_weight_kg=NULL,cargo_description=NULL,passenger_count=2,pickup_datetime=$1,fleet_status='Assigned' WHERE request_id=3",[departure]);
  await connection.query("UPDATE vehicles SET operational_use=NULL,cargo_capacity_kg=NULL,seating_capacity=4,commissioning_status='Pending',registration_expiry='2099-01-01',insurance_expiry='2099-01-01' WHERE vehicle_id=2");
  await connection.query('DELETE FROM vehicledocuments');
  await connection.query("UPDATE dispatchschedules SET scheduled_departure=$1,scheduled_arrival=$2 WHERE dispatch_id=10",[departure,arrival]);
  const checklist=itemsForType('Pre-Trip',null).map(item_id=>({item_id}));
  await connection.query('UPDATE vehicleinspection SET checklist=$1::jsonb WHERE inspection_id=1',[JSON.stringify(checklist)]);
  await connection.query("INSERT INTO driverattendance(attendance_id,driver_id,date,time_in,status) VALUES(1,7,(NOW() AT TIME ZONE 'Asia/Manila')::date,NOW()-INTERVAL '1 hour','Present')");
  await connection.query("INSERT INTO driver_consents(consent_id,driver_id,policy_version,accepted_at,accepted_via) VALUES(1,7,1,NOW(),'web')");
  await connection.query("INSERT INTO gpstracking(tracking_id,trip_id,vehicle_id,latitude,longitude,accuracy,recorded_at) VALUES(1,11,2,14.5,121,5,NOW())");
  const response=await startTrip(new Request('http://localhost/api/trips/11/start',{method:'PUT',headers:{'content-type':'application/json'},body:'{}'}),{params:Promise.resolve({id:'11'})});
  const body=await response.json();
  expect(body.error).toBeUndefined();
  expect(response.status).toBe(200);
  expect(body.trip_status).toBe('Trip Started');
  expect((await connection.query('SELECT load_type FROM transportation_requests WHERE request_id=3')).rows[0].load_type).toBeNull();
  expect((await connection.query('SELECT commissioning_status FROM vehicles WHERE vehicle_id=2')).rows[0].commissioning_status).toBe('Pending');
  expect((await connection.query('SELECT count(*)::int AS n FROM vehicledocuments')).rows[0].n).toBe(0);
 },60000);

});
