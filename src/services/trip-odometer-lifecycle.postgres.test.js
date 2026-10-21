import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';

const h = vi.hoisted(() => ({ query:vi.fn(),transaction:vi.fn(),cargo:vi.fn(),proximity:vi.fn(),failMileage:false,afterTripLock:null,beforeCaptureRead:null }));
vi.mock('@/lib/db',()=>({query:h.query,withTransaction:h.transaction}));
vi.mock('@/lib/api/utils',()=>({requirePermission:async()=>({user:{role:'driver',driverId:2}}),parseBody:req=>req.json(),ok:body=>Response.json(body),err:(error,status=400)=>Response.json({error},{status}),handleError:e=>Response.json({error:e.message,code:e.code},{status:e.status??500}),AuthError:class extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}}));
vi.mock('@/services/status.service',()=>({syncVehicleStatus:async()=>null,syncDriverStatus:async()=>null}));
vi.mock('@/lib/audit',()=>({writeAudit:async()=>null}));
vi.mock('@/services/reservation-lifecycle.service',()=>({findRequestForDispatch:async()=>null,advanceReservation:async()=>null}));
vi.mock('@/services/cargo-execution.service',async importOriginal=>({...await importOriginal(),assertCargoCheckpoint:h.cargo}));
vi.mock('@/services/trip-geofence.service',()=>({checkDestinationProximity:h.proximity}));
vi.mock('@/lib/fuel/price-repository',()=>({fuelPrices:{applicable:async()=>null},fuelSchemaError:e=>e}));
vi.mock('@/services/live-trip-monitor.service',()=>({resolveMonitorAlerts:async()=>null}));
import { PUT as start } from '@/app/api/trips/[id]/start/route';
import { PUT as complete } from '@/app/api/trips/[id]/complete/route';
import { PUT as updateTrip } from '@/app/api/trips/[id]/route';

// All SQL runs in this throwaway namespace. No fixture default uses an operating sequence.
describe.skipIf(process.env.ODOMETER_FIXTURE_DB_TEST !== '1')('actual odometer lifecycle routes on isolated PostgreSQL',()=>{
 const schema=`odometer_lifecycle_${randomUUID().replaceAll('-','')}`;
 let pool;
 const run=async fn=>{
  const c=await pool.connect();
  try {
   await c.query('BEGIN');await c.query(`SET LOCAL search_path TO ${schema},pg_catalog`);
   await c.query("SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='10s'");
   const tx={query:async(sql,args)=>{
    if(h.beforeCaptureRead && sql.includes('FROM trip_odometer_captures') && sql.includes('committed_at IS NOT NULL')) {const hook=h.beforeCaptureRead;h.beforeCaptureRead=null;await hook();}
    if(h.failMileage && sql.startsWith('UPDATE vehicles')) throw new Error('Fixture vehicle write failure');
    const result=await c.query(sql,args);
    if(h.afterTripLock && sql.includes('FROM trips') && sql.includes('FOR UPDATE')) {const hook=h.afterTripLock;h.afterTripLock=null;await hook();}
    return result;
   }};
   const result=await fn(tx);await c.query('COMMIT');return result;
  } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
 };
 const db=(sql,args)=>run(tx=>tx.query(sql,args));
 const call=(handler,id)=>handler(new Request('http://localhost/api/trips/7',{method:'PUT',body:JSON.stringify({odometer_capture_id:id,odometer:999999,end_odometer:999999,distance:99999})}),{params:Promise.resolve({id:'7'})});
 const ready=async(stage='start',reading=120)=>{
  const id=randomUUID();
  await db(`INSERT INTO trip_odometer_captures(capture_id,trip_id,driver_id,vehicle_id,stage,storage_key,image_sha256,content_type,byte_size,state,reading_km,unit,display_kind,scanned_at)
   VALUES($1,7,2,3,$2,$3,$4,'image/jpeg',4,'ready',$5,'km','total',NOW())`,[id,stage,`trip-odometer-photos/2/7/${stage}/${id}.jpg`,'a'.repeat(64),reading]);
  return id;
 };
 beforeAll(async()=>{
  loadEnvLocal();pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:4,connectionTimeoutMillis:5000});
  await pool.query(`CREATE SCHEMA ${schema}`);
  try {
   await run(async tx=>{
    const source=readFileSync('schema.sql','utf8');
    for(const table of ['trips','vehicles','drivers','employees','dispatchschedules','transportation_requests','vehicleinspection','system_settings','routes','locations','gpstracking']) {
     const definition=source.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
     if(!definition) throw new Error(`Missing fixture definition ${table}`);
     await tx.query(definition.replace(/ DEFAULT nextval\('[^']+'::regclass\)/g,'').replace(/ DEFAULT uuid_generate_v4\(\)/g,'').replace(/^\s*CONSTRAINT [^\n]* TRIGGER[^\n]*\r?\n/gm,''));
    }
    await tx.query('CREATE TABLE buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])');
    await tx.query(readFileSync('supabase/migrations/164_trip_odometer_captures.sql','utf8').replaceAll('public.',`${schema}.`).replaceAll('storage.buckets',`${schema}.buckets`));
    await tx.query(`INSERT INTO vehicles(vehicle_id,vehicle_name,vehicle_status,registration_expiry,required_license_class,operational_use,mileage) VALUES(3,'Fixture','Available','2099-01-01','B','Passenger',100);
     INSERT INTO drivers(driver_id,employee_id,driver_type,driver_status,license_number,license_type,license_class,license_expiry,license_verified_at,license_verified_by,license_verification_method) VALUES(2,1,'Passenger','Available','N04-19-013583','Professional','B','2099-01-01',NOW(),1,'physical_card');
     INSERT INTO trips(trip_id,driver_id,vehicle_id,trip_status) VALUES(7,2,3,'Driver Accepted');
     INSERT INTO vehicleinspection(inspection_id,vehicle_id,driver_id,trip_id,inspection_type,inspection_date,status,checklist) VALUES(1,3,2,7,'Pre-Trip',CURRENT_DATE,'Passed','[{"item_id":"brakes_tires"},{"item_id":"passenger_items"},{"item_id":"cabin_ready"}]');`);
   });
  } catch(e) {await pool.query(`DROP SCHEMA ${schema} CASCADE`);throw e;}
  h.query.mockImplementation(db);h.transaction.mockImplementation(run);
 },30000);
 beforeEach(async()=>{
  h.failMileage=false;h.afterTripLock=null;h.beforeCaptureRead=null;h.cargo.mockResolvedValue(null);h.proximity.mockResolvedValue({state:'inside'});vi.stubEnv('ODOMETER_PHOTO_REQUIRED','0');
  await db(`DELETE FROM trip_odometer_captures; UPDATE trips SET trip_status='Driver Accepted',start_time=NULL,end_time=NULL,start_odometer=NULL,end_odometer=NULL,distance=NULL,odometer_capture_required=false,fuel_estimate_captured_at=NULL WHERE trip_id=7; UPDATE vehicles SET mileage=100 WHERE vehicle_id=3`);
 });
 afterAll(async()=>{vi.unstubAllEnvs();try{if(pool)await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await pool?.end();}},15000);
 it('rolls back capture, trip and mileage when a later start write fails',async()=>{
  const id=await ready();h.failMileage=true;
  expect((await call(start,id)).status).toBe(500);h.failMileage=false;
  expect((await db('SELECT trip_status,start_odometer,odometer_capture_required FROM trips')).rows[0]).toEqual({trip_status:'Driver Accepted',start_odometer:null,odometer_capture_required:false});
  expect((await db('SELECT state,committed_at FROM trip_odometer_captures')).rows[0]).toEqual({state:'ready',committed_at:null});
  expect(Number((await db('SELECT mileage FROM vehicles')).rows[0].mileage)).toBe(100);
 },30000);
 it('persists server readings and one capture across simultaneous exact starts',async()=>{
  const id=await ready();const results=await Promise.all([call(start,id),call(start,id)]);
  expect(results.map(r=>r.status)).toEqual([200,200]);
  const rows=await Promise.all(results.map(r=>r.json()));expect(rows.map(r=>Number(r.start_odometer))).toEqual([120,120]);
  expect(rows.every(r=>r.odometer_capture_required)).toBe(true);
  expect(Number((await db('SELECT count(*) FROM trip_odometer_captures WHERE committed_at IS NOT NULL')).rows[0].count)).toBe(1);
 },30000);
 it('allows only one competing start capture and acknowledges its exact aged retry',async()=>{
  const ids=[await ready(),await ready('start',125)];const results=await Promise.all(ids.map(id=>call(start,id)));
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);const winner=ids[results.findIndex(r=>r.status===200)];
  await db("UPDATE trip_odometer_captures SET uploaded_at=NOW()-INTERVAL '2 hours'; UPDATE vehicles SET mileage=999");
  h.cargo.mockRejectedValue(new Error('Later cargo failure'));
  expect((await call(start,winner)).status).toBe(200);
 },30000);
 const active=async()=>{await db("UPDATE trips SET trip_status='Trip Started',start_odometer=100,start_time=NOW(),odometer_capture_required=true");};
 it('rolls back ending evidence and completion together on a vehicle failure',async()=>{
  await active();const id=await ready('end');h.failMileage=true;
  expect((await call(complete,id)).status).toBe(500);h.failMileage=false;
  expect((await db('SELECT trip_status,end_odometer,fuel_estimate_captured_at FROM trips')).rows[0]).toEqual({trip_status:'Trip Started',end_odometer:null,fuel_estimate_captured_at:null});
  expect((await db('SELECT state,committed_at FROM trip_odometer_captures')).rows[0]).toEqual({state:'ready',committed_at:null});
 },30000);
 it('concurrent exact completion returns one saved result before later geofence and cargo gates',async()=>{
  await active();const id=await ready('end');const results=await Promise.all([call(complete,id),call(complete,id)]);
  expect(results.map(r=>r.status)).toEqual([200,200]);
  const rows=await Promise.all(results.map(r=>r.json()));expect(rows.map(r=>Number(r.distance))).toEqual([20,20]);expect(rows[0].end_time).toBe(rows[1].end_time);
  h.cargo.mockRejectedValue(new Error('Later cargo failure'));h.proximity.mockResolvedValue({state:'outside',distanceM:5000});
  await db("UPDATE trip_odometer_captures SET uploaded_at=NOW()-INTERVAL '2 hours'; UPDATE vehicles SET mileage=999");
  expect((await call(complete,id)).status).toBe(200);
 },30000);
 it('rejects a second ending capture without rewriting the completed trip',async()=>{
  await active();const ids=[await ready('end'),await ready('end',125)];
  const results=await Promise.all(ids.map(id=>call(complete,id)));expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const saved=(await db('SELECT end_time,end_odometer FROM trips')).rows[0];
  expect((await call(complete,undefined)).status).toBe(409);
  expect((await db('SELECT end_time,end_odometer FROM trips')).rows[0]).toEqual(saved);
  expect(Number((await db('SELECT count(*) FROM trip_odometer_captures WHERE committed_at IS NOT NULL')).rows[0].count)).toBe(1);
 },30000);
 it.each(['Assigned','Driver Accepted'])('blocks flag-on raw completion from %s in real SQL',async status=>{
  vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');await db('UPDATE trips SET trip_status=$1',[status]);
  const response=await call(complete,undefined);expect(response.status).toBe(409);
  expect((await db('SELECT trip_status,start_odometer,end_odometer,odometer_capture_required FROM trips')).rows[0]).toEqual({trip_status:status,start_odometer:null,end_odometer:null,odometer_capture_required:false});
 },30000);
 it('does not let cancelled generic trips re-enter execution under enforcement',async()=>{
  vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');
  const put=body=>updateTrip(new Request('http://localhost/api/trips/7',{method:'PUT',body:JSON.stringify(body)}),{params:Promise.resolve({id:'7'})});
  expect((await put({trip_status:'Cancelled'})).status).toBe(200);
  for(const trip_status of ['Trip Started','Completed','Assigned']) expect((await put({trip_status,start_odometer:110,end_odometer:130})).status).toBe(409);
  expect((await db('SELECT trip_status,start_odometer,end_odometer,odometer_capture_required FROM trips')).rows[0]).toEqual({trip_status:'Cancelled',start_odometer:null,end_odometer:null,odometer_capture_required:false});
 },30000);
 it('refreshes exact start replay after a commit between ownership and evidence reads',async()=>{
  const id=await ready();let release,entered;
  const paused=new Promise(resolve=>{entered=resolve;});const resume=new Promise(resolve=>{release=resolve;});
  h.beforeCaptureRead=async()=>{entered();await resume;};
  const requestA=call(start,id);await paused;
  let winner;
  try {winner=await call(start,id);expect(winner.status).toBe(200);}finally{release();}
  const response=await requestA;expect(response.status).toBe(200);
  const saved=await winner.json();const replayed=await response.json();
  expect(replayed).toMatchObject({trip_status:'Trip Started',start_odometer:'120.00',odometer_capture_required:true,start_time:saved.start_time});
 },30000);
});
