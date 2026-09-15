import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn()}));
vi.mock('@/lib/uvvrp/uvvrp.service',()=>({getUvvrpPolicy:async()=>({enabled:false}),getExemptVehicleIds:async()=>new Set()}));
vi.mock('@/services/dispatch-settings.service',()=>({getDispatchPolicy:async()=>({})}));
vi.mock('@/services/driver-schedule.service',()=>({loadDriverScheduleContext:async()=>({schedules:new Map(),leave:new Map()})}));
vi.mock('@/lib/scheduling/driver-schedule',()=>({driverBlockReason:()=>null}));
import {query} from '@/lib/db';
import {detectRequestConflicts,evaluateRequestConflicts} from './conflicts';
let vehicle,incidents;
const request={request_id:1,vehicle_id:2,driver_id:3,passenger_count:2,pickup_datetime:'2026-09-15T10:00:00+08:00',scheduled_arrival:'2026-09-15T11:00:00+08:00'};
beforeEach(()=>{
 vehicle={vehicle_id:2,plate_number:'ABC123',vehicle_status:'Available',seating_capacity:4,fuel_level:80,registration_expiry:'2028-01-01',insurance_expiry:'2028-01-01'};incidents=[];
 query.mockImplementation(async sql=>({rows:sql.includes('FROM driverincidents')?incidents:sql.includes('FROM vehicles WHERE')?[vehicle]:sql.includes('FROM drivers d')?[{driver_id:3,driver_status:'Available',license_expiry:'2028-01-01'}]:sql.includes('FROM driver_vehicle_assignments a')?[{vehicle_id:2,driver_id:3}]:[]}));
});
it('distinguishes missing capacity from a successful empty incident check and rejects failed probes',async()=>{
 vehicle.seating_capacity=null;
 const result=await detectRequestConflicts(request,{includeEvidence:true,strict:true});
 expect(result.checks.find(c=>c.id==='capacity').status).toBe('missing');
 expect(result.checks.find(c=>c.id==='incidents').status).toBe('verified');
 query.mockRejectedValueOnce(new Error('offline'));
 await expect(detectRequestConflicts(request,{includeEvidence:true,strict:true})).rejects.toThrow('offline');
});
it('uses grounding facts even when the vehicle status projection still says Available, without private narrative',async()=>{
 incidents=[{incident_id:7,incident_type:'Breakdown',severity:'Minor',vehicle_id:2,description:'private'}];
 const result=await detectRequestConflicts(request,{includeEvidence:true,strict:true});
 expect(result.conflicts).toContainEqual(expect.objectContaining({type:'incident',severity:'blocking'}));
 expect(JSON.stringify(result)).not.toContain('private');
 expect(result.checks.find(c=>c.id==='incidents').status).toBe('blocking');
});
it('protects maintenance beginning on the next service day, using an exclusive service end',()=>{
 const maintenance=[{vehicle_id:2,maintenance_date:'2026-09-16',status:'Scheduled'}];
 const trip={...request,pickup_datetime:'2026-09-15T23:00:00+08:00',scheduled_arrival:'2026-09-16T01:00:00+08:00'};
 expect(evaluateRequestConflicts(trip,{vehicle,maintenance}).some(c=>c.type==='maintenance_conflict')).toBe(true);
 expect(evaluateRequestConflicts({...trip,scheduled_arrival:'2026-09-16T00:00:00+08:00'},{vehicle,maintenance}).some(c=>c.type==='maintenance_conflict')).toBe(false);
});
