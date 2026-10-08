import { beforeEach,it,expect,vi } from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn()}));
vi.mock('@/services/dispatch-evidence.service',()=>({readDispatchRevision:vi.fn(async()=> 'revision')}));
vi.mock('@/services/route-resolver.service',()=>({resolveRequestEstimate:vi.fn(async()=>({durationMin:120,source:'TomTom'}))}));
vi.mock('@/services/driver-schedule.service',()=>({loadDriverScheduleContext:vi.fn(async()=>({schedules:new Map(),leave:new Map()}))}));
vi.mock('@/lib/ai/pair-scoring',async importOriginal=>({...await importOriginal(),resolveVehiclePairing:()=>({ok:true,kind:'designated',driver:{driver_id:7}}),resolveSubstituteForDate:()=>null}));
vi.mock('@/services/dispatch-radar.service',async importOriginal=>({...await importOriginal(),evaluateDispatchCandidate:vi.fn()}));
import { query } from '@/lib/db';
import { evaluateDispatchCandidate } from '@/services/dispatch-radar.service';
import { validatePairAvailability } from './recommendation.service';
let record,category,driver;
beforeEach(()=>{
  vi.clearAllMocks(); category=1;
  record={request_id:3,fleet_status:'Pending',passenger_count:8,requested_category_id:1,pickup_datetime:'2026-09-14T02:00:00Z'};
  driver={driver_id:7,driver_status:'Available',license_number:'N04-19-013583',license_type:'Professional',license_class:'B',license_expiry:'2028-01-01',license_verified_at:'2026-09-27T10:00:00+08:00',license_verified_by:1,license_verification_method:'physical_card'};
  query.mockImplementation(async sql=>{
    if(sql.includes('SELECT * FROM transportation_requests'))return {rows:[record]};
    if(sql.includes('FROM vehicles WHERE'))return {rows:[{vehicle_id:2,category_id:category,vehicle_status:'Available',seating_capacity:10,required_license_class:'B'}]};
    if(sql.includes('FROM drivers d'))return {rows:[driver]};
    return {rows:[]};
  });
  evaluateDispatchCandidate.mockResolvedValue({checks:[{id:'request',status:'verified'}],reviewable:true,dispatchContext:{mode:'SCHEDULED'},readiness:'REVIEW_REQUIRED',feasibility:{verdict:'UNKNOWN',reasons:['Departure plan needs review.']}});
});
const check=(allowReview=false)=>validatePairAvailability({request:{...record,passenger_count:1,requested_category_id:99},vehicleId:2,driverId:7,allowReview});
it('reloads linked request requirements and uses the actual service window',async()=>{
  const result=await check(true);expect(result.ok).toBe(true);
  expect(evaluateDispatchCandidate.mock.calls[0][0].request.passenger_count).toBe(8);
  expect(result.serviceEnd).toBe('2026-09-14T04:00:00.000Z');
});
it('rejects cancelled requests and incompatible classes before route evaluation',async()=>{
  record.fleet_status='Cancelled';expect((await check()).ok).toBe(false);
  record.fleet_status='Pending';category=2;expect((await check()).ok).toBe(false);
  expect(evaluateDispatchCandidate).not.toHaveBeenCalled();
});
it('never treats a failed authoritative request lookup as permission to assign',async()=>{
  query.mockRejectedValue(new Error('database unavailable'));
  await expect(check()).rejects.toThrow('database unavailable');
});
it('requires explicit manual review for scheduled uncertainty and never permits missing capacity evidence',async()=>{
 expect((await check()).conflict.reviewable).toBe(true);
 expect((await check(true)).ok).toBe(true);
 evaluateDispatchCandidate.mockResolvedValue({checks:[{id:'capacity',status:'missing'}],reviewable:false,dispatchContext:{mode:'SCHEDULED'},readiness:'REVIEW_REQUIRED',feasibility:{verdict:'UNKNOWN',reasons:[]}});
 expect((await check(true)).conflict.reviewable).toBe(false);
});
it('rejects a Student Permit before review overrides or candidate evaluation',async()=>{
  driver.license_type='Student Permit';
  const result=await check(true);
  expect(result.ok).toBe(false);
  expect(result.conflict).toMatchObject({type:'driver_license',severity:'blocking'});
  expect(result.conflict.message).toMatch(/Student Permit is not eligible/i);
  expect(evaluateDispatchCandidate).not.toHaveBeenCalled();
});
it('rejects license class that does not cover the selected vehicle',async()=>{
  driver.license_class='B1';
  const result=await check();
  expect(result.ok).toBe(false);
  expect(result.conflict.message).toMatch(/License class does not cover this vehicle/i);
});
it('blocks an overweight cargo pair with the shared gate message before candidate evaluation',async()=>{
  record.load_type='Cargo';record.passenger_count=null;record.cargo_weight_kg=1800;record.cargo_description='Rice';
  query.mockImplementation(async sql=>{
    if(sql.includes('SELECT * FROM transportation_requests'))return {rows:[record]};
    if(sql.includes('FROM vehicles WHERE'))return {rows:[{vehicle_id:2,plate_number:'TRK 5678',category_id:category,vehicle_status:'Available',operational_use:'Cargo',cargo_capacity_kg:1000,required_license_class:'B'}]};
    if(sql.includes('FROM drivers d'))return {rows:[driver]};
    return {rows:[]};
  });
  const result=await validatePairAvailability({request:{...record},vehicleId:2,driverId:7});
  expect(result.ok).toBe(false);
  expect(result.conflict).toMatchObject({type:'capacity_mismatch',severity:'blocking'});
  expect(result.conflict.message).toBe('Vehicle TRK 5678 cargo capacity 1000 kg, request needs 1800 kg (over by 800 kg).');
  expect(evaluateDispatchCandidate).not.toHaveBeenCalled();
});

it('blocks a capacity-eligible typed pair without commissioned verified road evidence, even with review override', async()=>{
 record.load_type='Passenger';
 query.mockImplementation(async sql=>{
  if(sql.includes('SELECT * FROM transportation_requests')) return {rows:[record]};
  if(sql.includes('FROM vehicles WHERE')) return {rows:[{vehicle_id:2, plate_number:'ABC1234',category_id:1,operational_use:'Passenger',commissioning_status:'Pending',seating_capacity:10,required_license_class:'B'}]};
  if(sql.includes('FROM drivers d')) return {rows:[driver]};
  return {rows:[]};
 });
 const result=await validatePairAvailability({request:record,vehicleId:2,driverId:7,allowReview:true});
 expect(result.ok).toBe(false);
 expect(result.conflict.type).toBe('road_readiness');
 expect(result.conflict.detail.blockers).toContain('COMMISSIONING_NOT_READY');
 expect(evaluateDispatchCandidate).not.toHaveBeenCalled();
});

it('allows complete typed cargo evidence and pins the stored weight over stale caller input', async()=>{
 record={...record,load_type:'Cargo',passenger_count:null,cargo_weight_kg:650,cargo_description:'Rice',pickup_datetime:'2027-02-01T02:00:00Z'};
 const vehicle={vehicle_id:2,plate_number:'TRK5678',vehicle_status:'Registration Expired',registration_expiry:'2000-01-01',insurance_expiry:'2000-01-01',fleet_asset_code:'FLT-002',category_id:1,operational_use:'Cargo',commissioning_status:'Ready',cargo_capacity_kg:1000,required_license_class:'B'};
 const documents=['OR_CR','Insurance'].map(document_type=>({document_type,verification_status:'Verified',verified_by:8,verified_at:'2026-09-01T00:00:00Z',expiry_date:'2028-01-01'}));
 query.mockImplementation(async sql=>({rows:sql.includes('SELECT * FROM transportation_requests')?[record]:sql.includes('FROM vehicles WHERE')?[vehicle]:sql.includes('FROM vehicledocuments')?documents:sql.includes('FROM drivers d')?[driver]:[]}));
 evaluateDispatchCandidate.mockResolvedValue({checks:[{id:'request',status:'verified'},{id:'road_readiness',status:'verified'}],reviewable:false,dispatchContext:{mode:'SCHEDULED'},readiness:'VERIFIED',feasibility:{verdict:'SAFE',reasons:[]}});
 expect((await validatePairAvailability({request:{...record,cargo_weight_kg:1},vehicleId:2,driverId:7})).ok).toBe(true);
 expect(query.mock.calls.find(([sql])=>sql.includes('FROM vehicles WHERE'))[0]).toMatch(/fleet_asset_code/);
 expect(evaluateDispatchCandidate.mock.calls[0][0].request.cargo_weight_kg).toBe(650);
 record.cargo_weight_kg=1800;
 const result=await validatePairAvailability({request:{...record,cargo_weight_kg:1},vehicleId:2,driverId:7,allowReview:true});
 expect(result.conflict.message).toBe('Vehicle TRK5678 cargo capacity 1000 kg, request needs 1800 kg (over by 800 kg).');
});

it('rejects a deficient explicit cargo service window before review overrides',async()=>{
 record={...record,load_type:'Cargo',passenger_count:null,cargo_weight_kg:650,cargo_description:'Rice',pickup_datetime:'2027-02-01T02:00:00Z',scheduled_arrival:'2027-02-01T03:00:00Z'};
 const result=await validatePairAvailability({request:record,vehicleId:2,driverId:7,allowReview:true});
 expect(result).toMatchObject({ok:false,conflict:{type:'service_window',severity:'blocking'}});
 expect(evaluateDispatchCandidate).not.toHaveBeenCalled();
});
it('rejects equal explicit pickup and arrival at the shared gate',async()=>{
 record.scheduled_arrival=record.pickup_datetime;
 const result=await check(true);
 expect(result).toMatchObject({ok:false,conflict:{type:'service_window',severity:'blocking'}});
 expect(evaluateDispatchCandidate).not.toHaveBeenCalled();
});
