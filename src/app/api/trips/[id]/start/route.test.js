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
beforeEach(()=>{
 vi.clearAllMocks();
 query.mockImplementation(async sql=>({rows:sql.includes('FROM dispatchschedules') ? [{dispatch_id:8,driver_id:2,vehicle_id:3,scheduled_departure:new Date(Date.now()+15*60_000).toISOString()}]
   :sql.includes('FROM vehicleinspection') ? [{status:'Passed'}]
   :sql.includes('FROM vehicles') ? [{registration_expiry:'2099-01-01',vehicle_status:'Available'}]
   :sql.includes('FROM drivers') ? [{license_expiry:'2099-01-01',driver_status:'Available'}]:[]}));
});
const run=()=>PUT(new Request('http://localhost/api/trips/7/start',{method:'PUT'}),{params:Promise.resolve({id:'7'})});
it('rechecks the committed pair and excludes only the owned trip, blocking changed evidence before writes',async()=>{
 validatePairAvailability.mockResolvedValue({ok:false,conflict:{message:'New maintenance conflict'}});
 expect((await run()).status).toBe(409);
 expect(validatePairAvailability).toHaveBeenCalledWith(expect.objectContaining({vehicleId:3,driverId:2,excludeTripId:7,request:expect.objectContaining({dispatch_id:8})}));
 expect(commitDispatchEvidence).not.toHaveBeenCalled();
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
