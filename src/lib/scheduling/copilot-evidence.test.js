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

it('verifies cargo request requirements without a passenger count', async () => {
 vehicle = {...vehicle, operational_use:'Cargo', cargo_capacity_kg:1000};
 const result = await detectRequestConflicts({...request, load_type:'Cargo', passenger_count:null, cargo_weight_kg:650, cargo_description:'Rice'}, {includeEvidence:true, strict:true});
 expect(result.checks.find(c=>c.id==='request').status).toBe('verified');
});

it('returns fully verified real cargo checks with complete stored evidence',async()=>{
 const cargo={...request,load_type:'Cargo',passenger_count:null,cargo_weight_kg:650,cargo_description:'Rice',pickup_datetime:'2027-02-01T10:00:00+08:00',scheduled_arrival:'2027-02-01T13:00:00+08:00'};
 vehicle={...vehicle,vehicle_status:'Registration Expired',registration_expiry:'2000-01-01',insurance_expiry:'2000-01-01',fleet_asset_code:'FLT-002',category_id:1,required_license_class:'B',commissioning_status:'Ready',operational_use:'Cargo',cargo_capacity_kg:1000};
 const driver={driver_id:3,driver_status:'Available',license_number:'N04-19-013583',license_type:'Professional',license_class:'B',license_expiry:'2028-01-01',license_verified_at:'2026-09-01T00:00:00Z',license_verified_by:8,license_verification_method:'physical_card',_schedule_load:0};
 const docs=['OR_CR','Insurance'].map(document_type=>({document_type,verification_status:'Verified',verified_by:8,verified_at:'2026-09-01T00:00:00Z',expiry_date:'2028-01-01'}));
 query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicles WHERE')?[vehicle]:sql.includes('FROM drivers d')?[driver]:sql.includes('FROM vehicledocuments')?docs:sql.includes('FROM driver_vehicle_assignments a')?[{vehicle_id:2,driver_id:3}]:[]}));
 const result=await detectRequestConflicts(cargo,{includeEvidence:true,strict:true});
 expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({id:'road_readiness',status:'verified'}),expect.objectContaining({id:'capacity',status:'verified'}),expect.objectContaining({id:'request',status:'verified'})]));
 expect(result.checks.every(c=>c.status === 'verified')).toBe(true);
 expect(query.mock.calls.find(([sql])=>sql.includes('FROM vehicles WHERE'))[0]).toContain('fleet_asset_code');
});
