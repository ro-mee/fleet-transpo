import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn(),withTransaction:vi.fn()}));
vi.mock('@/lib/api/utils',()=>({requirePermission:vi.fn(async()=>({user:{employeeId:1}})),parseBody:vi.fn(async()=>({})),ok:body=>Response.json(body),err:(message,status)=>Response.json({error:message},{status}),handleError:e=>Response.json({error:e.message},{status:e.status??500}),AuthError:class extends Error {constructor(message,status){super(message);this.status=status;}}}));
vi.mock('@/lib/api/ownership',()=>({assertTripOwnership:vi.fn(async()=>({trip_id:7,dispatch_id:8,driver_id:2,vehicle_id:3,trip_status:'Driver Accepted'}))}));
vi.mock('@/services/status.service',()=>({syncVehicleStatus:vi.fn(),syncDriverStatus:vi.fn()}));
vi.mock('@/services/reservation-lifecycle.service',()=>({findRequestForDispatch:vi.fn(async()=>({request_id:9,fleet_status:'Assigned'})),advanceReservation:vi.fn()}));
vi.mock('@/lib/scheduling/start-window',()=>({resolveStartWindow:vi.fn(async()=>null)}));
vi.mock('@/lib/scheduling/driver-schedule',()=>({driverBlockReason:vi.fn(()=>null)}));
vi.mock('@/services/driver-schedule.service',()=>({loadDriverScheduleContext:vi.fn(async()=>({}))}));
vi.mock('@/lib/audit',()=>({writeAudit:vi.fn()}));
vi.mock('@/services/recommendation.service',()=>({validatePairAvailability:vi.fn()}));
vi.mock('@/services/dispatch-evidence.service',()=>({commitDispatchEvidence:vi.fn()}));
import {query} from '@/lib/db';
import {validatePairAvailability} from '@/services/recommendation.service';
import {commitDispatchEvidence} from '@/services/dispatch-evidence.service';
import {PUT} from './route';
import {findRequestForDispatch} from '@/services/reservation-lifecycle.service';
const PASSENGER_CHECKLIST = [{item_id:'brakes_tires'},{item_id:'passenger_items'},{item_id:'cabin_ready'}];
const CARGO_CHECKLIST = [{item_id:'brakes_tires'},{item_id:'cargo_secure'},{item_id:'cabin_ready'}];
const defaultQuery = (sql) => ({
  rows: sql.includes('FROM dispatchschedules') ? [{dispatch_id:8,driver_id:2,vehicle_id:3,scheduled_departure:new Date(Date.now()+15*60_000).toISOString()}]
    :sql.includes('FROM vehicleinspection') ? [{status:'Passed',checklist:PASSENGER_CHECKLIST}]
    :sql.includes('tr.load_type') ? [{load_type:null}]
    :sql.includes('FROM vehicles') ? [{registration_expiry:'2099-01-01',vehicle_status:'Available',required_license_class:'B'}]
    :sql.includes('FROM drivers') ? [{license_number:'N04-19-013583',license_type:'Professional',license_class:'B',license_expiry:'2099-01-01',license_verified_at:'2026-09-27T10:00:00+08:00',license_verified_by:1,license_verification_method:'physical_card',driver_status:'Available'}]:[],
});
beforeEach(()=>{
 vi.clearAllMocks();
 query.mockImplementation(async sql=>defaultQuery(sql));
 validatePairAvailability.mockResolvedValue({ok:true,commitToken:{revision:'current'}});
});
const run=()=>PUT(new Request('http://localhost/api/trips/7/start',{method:'PUT'}),{params:Promise.resolve({id:'7'})});
it('rechecks the committed pair and excludes only the owned trip, blocking changed evidence before writes',async()=>{
 validatePairAvailability.mockResolvedValue({ok:false,conflict:{message:'New maintenance conflict'}});
 expect((await run()).status).toBe(409);
 expect(validatePairAvailability).toHaveBeenCalledWith(expect.objectContaining({vehicleId:3,driverId:2,excludeTripId:7,request:expect.objectContaining({dispatch_id:8})}));
 expect(commitDispatchEvidence).not.toHaveBeenCalled();
});

it('returns the same cargo overload sentence unchanged before starting',async()=>{
 const message='Vehicle TRK5678 cargo capacity 1000 kg, request needs 1800 kg (over by 800 kg).';
 query.mockImplementation(async sql=>sql.includes('tr.load_type')?{rows:[{load_type:'Cargo'}]}:sql.includes('FROM vehicleinspection')?{rows:[{status:'Passed',checklist:CARGO_CHECKLIST}]}:defaultQuery(sql));
 validatePairAvailability.mockResolvedValueOnce({ok:false,conflict:{type:'capacity_mismatch',severity:'blocking',message}});
 const response=await run();
 expect(response.status).toBe(409);
 expect((await response.json()).error).toBe(message);
 expect(commitDispatchEvidence).not.toHaveBeenCalled();
});

it('keeps a committed legacy request null-classified when starting after the additive migrations',async()=>{
 findRequestForDispatch.mockResolvedValueOnce({request_id:9,fleet_status:'Assigned',load_type:null,passenger_count:2});
 const tx={query:vi.fn(async sql=>({rows:sql.startsWith('UPDATE trips')?[{trip_id:7,trip_status:'Trip Started',start_odometer:null}]:[]}))};
 commitDispatchEvidence.mockImplementation(async (_token,write)=>write(tx));
 expect((await run()).status).toBe(200);
 expect(validatePairAvailability).toHaveBeenCalledWith(expect.objectContaining({request:expect.objectContaining({load_type:null,passenger_count:2})}));
});
it('commits start under the evidence lock with a compare-and-set trip status',async()=>{
 const token={revision:'current'};
 validatePairAvailability.mockResolvedValue({ok:true,commitToken:token});
 const tx={query:vi.fn(async sql=>({rows:sql.startsWith('UPDATE trips') ? [{trip_id:7,trip_status:'Trip Started',start_odometer:null}]:[]}))};
 commitDispatchEvidence.mockImplementation(async (_token,write)=>write(tx));
 expect((await run()).status).toBe(200);
 expect(commitDispatchEvidence.mock.calls[0][0]).toBe(token);
 expect(tx.query.mock.calls[0][0]).toContain('AND trip_status = $3');
 expect(tx.query.mock.calls[0][1]).toEqual([null,'7','Driver Accepted']);
});
it('blocks start when no inspection exists for this trip',async()=>{
 query.mockImplementation(async sql=>
   sql.includes('FROM vehicleinspection') ? {rows:[]} : defaultQuery(sql));
 expect((await run()).status).toBe(400);
 expect((await (await run()).json()).error).toMatch(/inspection/i);
});
it('blocks start when the latest inspection for this trip Failed',async()=>{
 query.mockImplementation(async sql=>
   sql.includes('FROM vehicleinspection') ? {rows:[{status:'Failed'}]} : defaultQuery(sql));
 expect((await run()).status).toBe(400);
});
it('rechecks expiration immediately before the trip starts',async()=>{
 query.mockImplementation(async sql=>sql.includes('FROM drivers')
   ? {rows:[{license_number:'N04-19-013583',license_type:'Professional',license_class:'B',license_expiry:'2000-01-01',license_verified_at:'2026-09-27T10:00:00+08:00',license_verified_by:1,license_verification_method:'physical_card',driver_status:'Available'}]}
   : defaultQuery(sql));
 const response=await run();
 expect(response.status).toBe(400);
 expect((await response.json()).error).toMatch(/Expired license/i);
 expect(commitDispatchEvidence).not.toHaveBeenCalled();
});
it('blocks a driver whose license class does not cover the trip vehicle',async()=>{
 query.mockImplementation(async sql=>sql.includes('FROM vehicles')
   ? {rows:[{registration_expiry:'2099-01-01',vehicle_status:'Available',required_license_class:'B1'}]}
   : defaultQuery(sql));
 const response=await run();
 expect(response.status).toBe(400);
 expect((await response.json()).error).toMatch(/License class does not cover this vehicle/i);
});
it('blocks trip start when the staff license review is missing',async()=>{
 query.mockImplementation(async sql=>sql.includes('FROM drivers')
   ? {rows:[{license_number:'N04-19-013583',license_type:'Professional',license_class:'B',license_expiry:'2099-01-01',license_verified_at:null,license_verified_by:null,license_verification_method:null,driver_status:'Available'}]}
   : defaultQuery(sql));
 const response=await run();
 expect(response.status).toBe(400);
 expect((await response.json()).error).toMatch(/not been verified/i);
});
it('scopes the gate to this trip AND inspection_type Pre-Trip (a Pre-Shift row can never satisfy it)',async()=>{
  const tx={query:vi.fn(async sql=>({rows:sql.startsWith('UPDATE trips') ? [{trip_id:7,trip_status:'Trip Started',start_odometer:null}]:[]}))};
  commitDispatchEvidence.mockImplementation(async (_t,write)=>write(tx));
  expect((await run()).status).toBe(200);
  const gate=query.mock.calls.find((c)=>c[0].includes('FROM vehicleinspection'));
  expect(gate[0]).toContain('i.trip_id = $1');
  expect(gate[0]).toContain("i.inspection_type = 'Pre-Trip'");
});
it('blocks a cargo trip whose passed checklist is the passenger set',async()=>{
  query.mockImplementation(async sql=>
    sql.includes('tr.load_type') ? {rows:[{load_type:'Cargo'}]} : defaultQuery(sql));
  const response=await run();
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/cargo Pre-Trip inspection/);
  expect(commitDispatchEvidence).not.toHaveBeenCalled();
});
it('starts a cargo trip whose passed checklist is the cargo set',async()=>{
  query.mockImplementation(async sql=>
    sql.includes('tr.load_type') ? {rows:[{load_type:'Cargo'}]}
    :sql.includes('FROM vehicleinspection') ? {rows:[{status:'Passed',checklist:CARGO_CHECKLIST}]}
    :defaultQuery(sql));
  const tx={query:vi.fn(async sql=>({rows:sql.startsWith('UPDATE trips') ? [{trip_id:7,trip_status:'Trip Started',start_odometer:null}]:[]}))};
  commitDispatchEvidence.mockImplementation(async (_t,write)=>write(tx));
  expect((await run()).status).toBe(200);
});

it('uses renewed typed document evidence instead of an expired legacy registration projection',async()=>{
 query.mockImplementation(async sql=>sql.includes('tr.load_type')?{rows:[{load_type:'Cargo'}]}:sql.includes('FROM vehicles')?{rows:[{plate_number:'TRK5678',registration_expiry:'2000-01-01',vehicle_status:'Registration Expired',required_license_class:'B'}]}:sql.includes('FROM vehicleinspection')?{rows:[{status:'Passed',checklist:CARGO_CHECKLIST}]}:defaultQuery(sql));
 const tx={query:vi.fn(async sql=>({rows:sql.startsWith('UPDATE trips')?[{trip_id:7,trip_status:'Trip Started',start_odometer:null}]:[]}))};
 commitDispatchEvidence.mockImplementation(async (_token,write)=>write(tx));
 expect((await run()).status).toBe(200);
 expect(validatePairAvailability).toHaveBeenCalled();
});
it('preserves the legacy expired-registration start rejection',async()=>{
 query.mockImplementation(async sql=>sql.includes('FROM vehicles')?{rows:[{plate_number:'TRK5678',registration_expiry:'2000-01-01',vehicle_status:'Registration Expired',required_license_class:'B'}]}:defaultQuery(sql));
 expect((await run()).status).toBe(400);
 expect(validatePairAvailability).not.toHaveBeenCalled();
});
