import { beforeEach,it,expect,vi } from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn()}));
vi.mock('@/services/dispatch-evidence.service',()=>({readDispatchRevision:vi.fn(async()=> 'revision')}));
vi.mock('@/services/route-resolver.service',()=>({resolveRequestEstimate:vi.fn(async()=>({durationMin:120,source:'TomTom'}))}));
vi.mock('@/services/driver-schedule.service',()=>({loadDriverScheduleContext:vi.fn(async()=>({schedules:new Map(),leave:new Map()}))}));
vi.mock('@/lib/ai/pair-scoring',()=>({resolveVehiclePairing:()=>({ok:true,kind:'designated',driver:{driver_id:7}}),resolveSubstituteForDate:()=>null,vehicleOperationallyAvailable:()=>true,PAIRING_KIND:{DESIGNATED:'designated'}}));
vi.mock('@/services/dispatch-radar.service',()=>({evaluateDispatchCandidate:vi.fn(),serviceEnd:(request,estimate)=>new Date(new Date(request.pickup_datetime).getTime()+estimate.durationMin*60_000)}));
import { query } from '@/lib/db';
import { evaluateDispatchCandidate } from '@/services/dispatch-radar.service';
import { validatePairAvailability } from './recommendation.service';
let record,category;
beforeEach(()=>{
  vi.clearAllMocks(); category=1;
  record={request_id:3,fleet_status:'Pending',passenger_count:8,requested_category_id:1,pickup_datetime:'2026-09-14T02:00:00Z'};
  query.mockImplementation(async sql=>{
    if(sql.includes('SELECT * FROM transportation_requests'))return {rows:[record]};
    if(sql.includes('FROM vehicles WHERE'))return {rows:[{vehicle_id:2,category_id:category,vehicle_status:'Available',seating_capacity:10}]};
    if(sql.includes('FROM drivers d'))return {rows:[{driver_id:7,license_expiry:'2028-01-01'}]};
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
