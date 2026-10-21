import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), permission: vi.fn(), cargo: vi.fn(), proximity: vi.fn(), evidence: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: h.query, withTransaction: h.transaction }));
vi.mock('@/lib/api/utils', () => ({ requirePermission: h.permission, parseBody: req => req.json(), ok: body => Response.json(body), err: (error,status=400) => Response.json({error},{status}), handleError: e => Response.json({error:e.message,code:e.code},{status:e.status??500}), AuthError: class extends Error { constructor(message,status,code) { super(message); this.status=status; this.code=code; } } }));
vi.mock('@/services/status.service', () => ({syncVehicleStatus:vi.fn(async()=>null),syncDriverStatus:vi.fn(async()=>null)}));
vi.mock('@/lib/audit', () => ({writeAudit:vi.fn()}));
vi.mock('@/services/reservation-lifecycle.service', () => ({findRequestForDispatch:vi.fn(async()=>null),advanceReservation:vi.fn()}));
vi.mock('@/services/cargo-execution.service', () => ({prepareCargoLifecycle:vi.fn(),assertCargoCheckpoint:h.cargo}));
vi.mock('@/services/trip-geofence.service', () => ({checkDestinationProximity:h.proximity,checkPickupProximity:h.proximity}));
vi.mock('@/lib/fuel/price-repository', () => ({fuelPrices:{applicable:vi.fn(async()=>null)},fuelSchemaError:e=>e}));
vi.mock('@/services/live-trip-monitor.service', () => ({resolveMonitorAlerts:vi.fn()}));
vi.mock('@/services/recommendation.service', () => ({validatePairAvailability:vi.fn(async()=>({ok:true,commitToken:{revision:'fixture'}}))}));
vi.mock('@/services/dispatch-evidence.service', () => ({commitDispatchEvidence:h.evidence}));
vi.mock('@/lib/scheduling/start-window', () => ({resolveStartWindow:vi.fn(async()=>null)}));
import { PUT as start } from '@/app/api/trips/[id]/start/route';
import { PUT as complete } from '@/app/api/trips/[id]/complete/route';
import { completeTrip } from './trip-lifecycle.service';
import { setTripStatus } from './transition.service';
import { PUT as updateTrip } from '@/app/api/trips/[id]/route';
import { POST as createTrip } from '@/app/api/trips/route';

const id='11111111-1111-4111-8111-111111111111';
let trip, capture, vehicle, statements;
const session={user:{role:'driver',driverId:2}};
const call=(handler,body={})=>handler(new Request('http://localhost/api/trips/7',{method:'PUT',body:JSON.stringify(body)}),{params:Promise.resolve({id:'7'})});
beforeEach(()=>{
 vi.clearAllMocks(); vi.stubEnv('ODOMETER_PHOTO_REQUIRED','0');
 trip={trip_id:7,driver_id:2,vehicle_id:3,dispatch_id:null,trip_status:'Driver Accepted',start_odometer:100,odometer_capture_required:false};
 vehicle={vehicle_id:3,mileage:100,vehicle_status:'Available',registration_expiry:'2099-01-01',required_license_class:'B'};
 capture={capture_id:id,trip_id:7,driver_id:2,vehicle_id:3,stage:'start',state:'ready',reading_km:120,unit:'km',display_kind:'total',uploaded_at:new Date(),scanned_at:new Date(),content_type:'image/jpeg',storage_key:`trip-odometer-photos/2/7/start/${id}.jpg`};
 statements=[];
 h.permission.mockResolvedValue(session); h.cargo.mockResolvedValue(null); h.proximity.mockResolvedValue({state:'inside'});
 h.transaction.mockImplementation(async fn=>fn({query:h.query}));
 h.evidence.mockImplementation(async(_token,fn)=>h.transaction(fn));
 h.query.mockImplementation(async(sql,args=[])=>{
  statements.push([sql,args]);
  if(sql.includes('FROM trip_odometer_captures')) return {rows:sql.includes('committed_at IS NOT NULL')?(capture.committed_at?[{...capture}]:[]):args[0]===id?[{...capture}]:[]};
  if(sql.startsWith('UPDATE trip_odometer_captures')) {capture.state='committed';capture.committed_at=new Date();return {rows:[]};}
  if(sql.includes('FROM vehicleinspection')) return {rows:[{status:'Passed',checklist:['brakes_tires','passenger_items','cabin_ready'].map(item_id=>({item_id}))}]};
  if(sql.includes('FROM trips t')) return {rows:[{...trip,vehicle_mileage:vehicle.mileage,driver_type:'Passenger',load_type:null,operational_use:'Passenger'}]};
  if(sql.includes('FROM vehicles')) return {rows:[{...vehicle}]};
  if(sql.includes('SELECT d.driver_type')) return {rows:[{driver_type:'Passenger',operational_use:'Passenger'}]};
  if(sql.includes('FROM drivers')) return {rows:[{license_number:'N04-19-013583',license_type:'Professional',license_class:'B',license_expiry:'2099-01-01',license_verified_at:'2026-01-01',license_verified_by:1,license_verification_method:'physical_card',driver_status:'Available'}]};
  if(sql.includes('FROM trips')) return {rows:[{...trip,vehicle_mileage:vehicle.mileage,driver_type:'Passenger',load_type:null,operational_use:'Passenger'}]};
  if(sql.includes('UPDATE trips')) {
    if(sql.startsWith('UPDATE trips SET ') && !sql.includes("trip_status = '")) {
      for (const [,field,index] of sql.matchAll(/(\w+) = \$(\d+)/g)) {
        if(field !== 'trip_id') trip[field]=args[Number(index)-1];
      }
    }
    if(sql.includes("trip_status = 'Trip Started'")) Object.assign(trip,{trip_status:'Trip Started',start_odometer:args[0],odometer_capture_required:sql.includes('odometer_capture_required')?Boolean(args[3]):false});
    if(sql.includes("trip_status = 'Completed'")) Object.assign(trip,{trip_status:'Completed',end_odometer:args[0],distance:args[1],distance_provenance:args[6]});
    return {rows:[{...trip}]};
  }
  if(sql.includes('UPDATE vehicles')) vehicle.mileage=args[0];
  return {rows:[]};
 });
});
afterEach(()=>vi.unstubAllEnvs());
it('requires a start photo when enabled, ignoring a posted number',async()=>{
 vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');
 const response=await call(start,{odometer:120});
 expect(response.status).toBe(409); expect((await response.json()).code).toBe('ODOMETER_PHOTO_REQUIRED');
});
it('uses extracted start and latches explicit pilot capture even while disabled',async()=>{
 const response=await call(start,{odometer_capture_id:id,odometer:999999});
 expect(response.status).toBe(200); expect(await response.json()).toMatchObject({start_odometer:120,odometer_capture_required:true});
 expect(capture.state).toBe('committed'); expect(vehicle.mileage).toBe(120);
});
it('rechecks the locked assignment before consuming start evidence',async()=>{
 h.transaction.mockImplementationOnce(async fn=>{trip.vehicle_id=4;return fn({query:h.query});});
 expect((await call(start,{odometer_capture_id:id})).status).toBe(409); expect(capture.state).toBe('ready');
});
it('uses fresh locked mileage rather than the advisory reading',async()=>{
 h.transaction.mockImplementationOnce(async fn=>{vehicle.mileage=150;return fn({query:h.query});});
 expect((await call(start,{odometer_capture_id:id})).status).toBe(409); expect(capture.state).toBe('ready');
});
it('acknowledges committed start before new inspection/cargo/age gates',async()=>{
 trip.trip_status='Trip Started';trip.odometer_capture_required=true; trip.start_odometer=120;
 capture.state='committed';capture.committed_at=new Date();capture.uploaded_at=new Date(0);
 h.cargo.mockRejectedValue(new Error('New cargo failure'));
 const response=await call(start,{odometer_capture_id:id});
 expect(response.status).toBe(200);expect((await response.json()).start_odometer).toBe(120);
 expect(h.cargo).not.toHaveBeenCalled();expect(statements.some(([sql])=>sql.includes('FROM vehicleinspection'))).toBe(false);
});
it.each([undefined,'22222222-2222-4222-8222-222222222222'])('rejects changed or missing start capture after commit (%s)',async odometer_capture_id=>{
 trip.trip_status='Trip Started';trip.odometer_capture_required=true; capture.state='committed';capture.committed_at=new Date();
 expect((await call(start,{odometer_capture_id,odometer:200})).status).toBe(409);
 expect(statements.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
const ending=()=>{trip.trip_status='Trip Started';trip.odometer_capture_required=true;capture.stage='end';capture.storage_key=`trip-odometer-photos/2/7/end/${id}.jpg`;};
it('requires completion evidence and ignores forged end/start/distance fields',async()=>{
 ending();
 expect((await call(complete,{end_odometer:130})).status).toBe(409);
 const response=await call(complete,{odometer_capture_id:id,end_odometer:999,start_odometer:1,distance:998});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({end_odometer:120,distance:20,distance_provenance:'odometer'});
});
it('keeps active legacy completion manual after rollout is enabled',async()=>{
 trip.trip_status='Trip Started';vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');
 expect((await call(complete,{end_odometer:130})).status).toBe(200);expect(trip.end_odometer).toBe(130);
});
it('returns committed completion before a later geofence failure',async()=>{
 ending();trip.trip_status='Completed';trip.end_odometer=120;trip.distance=20;capture.state='committed';capture.committed_at=new Date();capture.uploaded_at=new Date(0);
 h.proximity.mockResolvedValue({state:'outside',distanceM:5000});h.cargo.mockRejectedValue(new Error('New cargo failure'));
 const response=await call(complete,{odometer_capture_id:id});
 expect(response.status).toBe(200);expect((await response.json()).end_odometer).toBe(120);expect(h.proximity).not.toHaveBeenCalled();expect(h.cargo).not.toHaveBeenCalled();
});
it.each([90,99])('rejects ending reading below the locked start/current mileage: %s',async reading=>{
 ending();capture.reading_km=reading;
 await expect(completeTrip(7,session,{odometerCaptureId:id})).rejects.toMatchObject({status:409});expect(capture.state).toBe('ready');
});
it.each(['Trip Started','At Pickup','Completed'])('generic create and update cannot jump into %s',async trip_status=>{
 vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');
 expect((await call(updateTrip,{trip_status})).status).toBe(409);
 const response=await createTrip(new Request('http://localhost/api/trips',{method:'POST',body:JSON.stringify({trip_status})}));
 expect(response.status).toBe(409);expect(statements.some(([sql])=>sql.startsWith('UPDATE')||sql.startsWith('INSERT'))).toBe(false);
});
it.each([{end_odometer:200},{distance:10},{vehicle_id:8},{driver_id:9},{odometer_capture_required:false,notes:'x'}])('blocks required generic rewrites %j',async patch=>{
 ending();expect((await call(updateTrip,patch)).status).toBe(409);expect(capture.state).toBe('ready');
});
it('still allows notes, ongoing legs and cancellation through the generic route',async()=>{
 ending();
 for(const patch of [{notes:'x'},{trip_status:'At Pickup'},{trip_status:'Cancelled'}]) expect((await call(updateTrip,patch)).status).toBe(200);
 trip.trip_status='Completed';expect((await call(updateTrip,{notes:'Archived note'})).status).toBe(200);
});
it('shared transition rejects raw start and completion while allowing normal legs',async()=>{
 vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');
 await expect(setTripStatus({tripId:7,to:'Trip Started',session})).rejects.toMatchObject({code:'ODOMETER_PHOTO_REQUIRED'});
 ending();await expect(setTripStatus({tripId:7,to:'At Pickup',session})).resolves.toBeDefined();
 trip.trip_status='Drop-off';await expect(setTripStatus({tripId:7,to:'Completed',session})).rejects.toMatchObject({code:'ODOMETER_PHOTO_REQUIRED'});
});
it('rechecks transition policy after waiting for the trip lock',async()=>{
 trip.trip_status='Drop-off';
 h.transaction.mockImplementationOnce(async fn=>{trip.odometer_capture_required=true;return fn({query:h.query});});
 await expect(setTripStatus({tripId:7,to:'Completed',session})).rejects.toMatchObject({code:'ODOMETER_PHOTO_REQUIRED'});
});
it('rechecks driver ownership before acknowledging saved evidence',async()=>{
 ending();trip.trip_status='Completed';capture.state='committed';capture.committed_at=new Date();h.permission.mockResolvedValue({user:{role:'driver',driverId:9}});
 expect((await call(complete,{odometer_capture_id:id})).status).toBe(404);
});
it('checks normal first-write geofence and preserves a ready photo on failure',async()=>{
 ending();h.proximity.mockResolvedValue({state:'outside',distanceM:5000});
 expect((await call(complete,{odometer_capture_id:id})).status).toBe(409);expect(capture.state).toBe('ready');expect(trip.trip_status).toBe('Trip Started');
});
it('retains a ready photo when cargo authority refuses completion',async()=>{
 ending();h.cargo.mockRejectedValue(Object.assign(new Error('Receiver confirmation required'),{status:409}));
 expect((await call(complete,{odometer_capture_id:id})).status).toBe(409);expect(capture.state).toBe('ready');
});

it.each(['Assigned','Driver Accepted'])('refuses raw completion of an unstarted %s trip while enforcement is on',async trip_status=>{
 vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');Object.assign(trip,{trip_status,start_odometer:null});
 const response=await call(complete,{end_odometer:130});
 expect(response.status).toBe(409);expect((await response.json()).code).toBe('ODOMETER_PHOTO_REQUIRED');
 expect(trip.trip_status).toBe(trip_status);expect(capture.state).toBe('ready');
 expect(statements.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it.each(['Trip Started','At Pickup','Completed','Assigned'])('cannot cancel then use generic %s/raw readings to escape enforcement',async trip_status=>{
 vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');
 expect((await call(updateTrip,{trip_status:'Cancelled'})).status).toBe(200);
 expect(trip.trip_status).toBe('Cancelled');
 const response=await call(updateTrip,{trip_status,start_odometer:110,end_odometer:130});
 expect(response.status).toBe(409);expect(trip.trip_status).toBe('Cancelled');expect(trip.odometer_capture_required).toBe(false);
});
it.each(['Cancelled','Completed'])('keeps historical %s reading and note corrections usable',async trip_status=>{
 vi.stubEnv('ODOMETER_PHOTO_REQUIRED','1');trip.trip_status=trip_status;
 expect((await call(updateTrip,{end_odometer:130,notes:'Historical correction'})).status).toBe(200);
 expect(trip).toMatchObject({trip_status,end_odometer:130,notes:'Historical correction'});
});
it('acknowledges the current saved start when another request commits after its ownership read',async()=>{
 trip.start_odometer=null;
 const execute=h.query.getMockImplementation();let release,entered;
 const paused=new Promise(resolve=>{entered=resolve;});const resume=new Promise(resolve=>{release=resolve;});
 let pauseFirst=true;
 h.query.mockImplementation(async(sql,args)=>{
  if(pauseFirst && sql.includes('FROM trip_odometer_captures') && sql.includes('committed_at IS NOT NULL')) {
    pauseFirst=false;entered();await resume;
  }
  return execute(sql,args);
 });
 const requestA=call(start,{odometer_capture_id:id});
 await paused;
 try {
   const requestB=await call(start,{odometer_capture_id:id});expect(requestB.status).toBe(200);
   expect(await requestB.json()).toMatchObject({trip_status:'Trip Started',start_odometer:120,odometer_capture_required:true});
 } finally {release();}
 const response=await requestA;
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({trip_status:'Trip Started',start_odometer:120,odometer_capture_required:true});
});
