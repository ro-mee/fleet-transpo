import { beforeEach,it,expect,vi } from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn()}));
vi.mock('@/services/standby.service',()=>({standbyState:vi.fn()}));
vi.mock('@/services/dispatch-settings.service',async()=>({getDispatchPolicy:vi.fn(async()=> (await import('@/lib/dispatch-policy')).DEFAULT_DISPATCH_POLICY)}));
vi.mock('@/lib/scheduling/conflicts',()=>({detectRequestConflicts:vi.fn()}));
vi.mock('@/services/driver-schedule.service',()=>({loadDriverScheduleContext:vi.fn(async()=>({}))}));
vi.mock('@/lib/scheduling/driver-schedule',()=>({driverBlockReason:vi.fn(()=>null)}));
vi.mock('@/services/route-resolver.service',()=>({resolveRouteEndpoints:vi.fn(async()=>({originLocation:{latitude:14.5,longitude:121},destinationLocation:{latitude:14.6,longitude:121}}))}));
vi.mock('@/services/route-feasibility-context.service',()=>({resolveDeadheadMinutes:vi.fn(),provenanceOfEstimate:()=> 'snapshot'}));
import { query } from '@/lib/db';
import { standbyState } from '@/services/standby.service';
import { detectRequestConflicts } from '@/lib/scheduling/conflicts';
import { resolveDeadheadMinutes } from '@/services/route-feasibility-context.service';
import { resolveRouteEndpoints } from '@/services/route-resolver.service';
import { evaluateDispatchCandidate,applyDispatchRadar } from './dispatch-radar.service';
let now, request;
beforeEach(()=>{
  vi.clearAllMocks(); now=new Date(); request={request_id:1,fleet_status:'Pending',pickup_datetime:new Date(+now+60*60_000).toISOString(),pickup_location:'NAIA',dropoff_location:'Makati'};
  query.mockResolvedValue({rows:[]}); detectRequestConflicts.mockResolvedValue({conflicts:[],checks:[{id:'request',status:'verified'}]});
  standbyState.mockImplementation(async id=>({checked_in:true,consented:true,busy:false,session_live:true,standby_tracking_enabled:true,location_source:'standby',location_vehicle_id:id,standby_latitude:14.5+id/100,standby_longitude:121,location_accuracy_m:10,location_observed_at:now}));
  resolveDeadheadMinutes.mockResolvedValue({minutes:5,distanceKm:6,provenance:'live',computedAt:now.toISOString()});
});
const evaluate = (extra={})=>evaluateDispatchCandidate({request,vehicleId:1,driverId:1,estimate:{durationMin:30,source:"TomTom"},now,...extra});
it('uses only fresh owned-trip GPS at start after standby tracking has stopped',async()=>{
  request={...request,fleet_status:'Assigned'};
  standbyState.mockResolvedValue({checked_in:true,consented:true,busy:false,session_live:false,standby_tracking_enabled:false});
  const fix={latitude:14.5,longitude:121,accuracy:10,observed_at:now};
  query.mockImplementation(async sql=>({rows:sql.includes('FROM gpstracking') ? [fix] : []}));
  const result=await evaluate({excludeTripId:9});
  expect(result.feasibility.verdict).toBe('SAFE');expect(result.dispatchContext.liveLocationUsed).toBe(true);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('t.driver_id=$2 AND t.vehicle_id=$3'),[9,1,1]);
  fix.observed_at=new Date(+now-120_000);
  expect((await evaluate({excludeTripId:9})).proximity).toBeUndefined();
});
it('retains a future 110-minute gap, uses dated routing and subtracts the configured floor once',async()=>{
 request={...request,pickup_datetime:new Date(+now+3*86400_000).toISOString()};
 const finish=new Date(+new Date(request.pickup_datetime)-110*60_000);
 query.mockResolvedValue({rows:[{dispatch_id:5,driver_id:1,vehicle_id:1,status:'Scheduled',scheduled_departure:new Date(+finish-60*60_000),scheduled_arrival:finish,dropoff_location:'NAIA'}]});
 const policy={...(await import('@/lib/dispatch-policy')).DEFAULT_DISPATCH_POLICY,safetyBufferMinutes:10,bufferFloorMinutes:20};
 const result=await evaluate({policy});
 expect(result.temporalContext.horizon).toBe('FUTURE');
 expect(result.scheduleEvidence).toMatchObject({gapMinutes:110,transferMinutes:5,preparationMinutes:20,usableSlackMinutes:85});
 expect(result.feasibility.pickupBufferMin).toBe(85);
 expect(resolveDeadheadMinutes.mock.calls[0][2].departAt).toEqual(finish);
 expect(standbyState).not.toHaveBeenCalled();expect(result.proximity).toBeUndefined();
});
it('does not treat an overrun active trip as released, or completed history as a live position',async()=>{
 query.mockResolvedValue({rows:[{dispatch_id:5,driver_id:1,vehicle_id:1,status:'In Progress',scheduled_departure:new Date(+now-60*60_000),scheduled_arrival:new Date(+now-10*60_000)}]});
 expect((await evaluate()).feasibility.verdict).toBe('UNKNOWN');expect(resolveDeadheadMinutes).not.toHaveBeenCalled();
 query.mockResolvedValue({rows:[{dispatch_id:5,driver_id:1,vehicle_id:1,status:'Completed',scheduled_departure:new Date(+now-60*60_000),actual_end:new Date(+now-10*60_000)}]});
 const result=await evaluate();
 expect(result.scheduleEvidence.releaseSource).toBe('recorded completion');expect(result.dispatchContext.originType).toBe('CURRENT_GPS');
});
it('does not load current GPS or route a scheduled candidate with no preceding trip',async()=>{
  const result=await evaluate({request:{...request,pickup_datetime:new Date(+now+86400_000).toISOString()}});
  expect(result.dispatchContext.mode).toBe('SCHEDULED'); expect(standbyState).not.toHaveBeenCalled(); expect(resolveDeadheadMinutes).not.toHaveBeenCalled(); expect(result).not.toHaveProperty('proximity');
});
it('checks both next resources and rejects a threatened vehicle booking',async()=>{
  query.mockResolvedValue({rows:[{dispatch_id:10,driver_id:1,vehicle_id:9,scheduled_departure:new Date(+now+180*60_000),pickup_location:'NAIA'},{dispatch_id:11,driver_id:9,vehicle_id:1,scheduled_departure:new Date(+now+92*60_000),pickup_location:'NAIA'}]});
  const result=await evaluate(); expect(result.feasibility.verdict).toBe('INFEASIBLE');expect(result.feasibility.protectedDispatchIds).toEqual([10,11]);
});
it('keeps schedule failures unknown and considers the sixth pair outside 5 km',async()=>{
  const candidates=Array.from({length:6},(_,i)=>({driver_id:i+1,vehicle_id:i+1,driver:{},score:80-i}));
  resolveDeadheadMinutes.mockImplementation(async()=>({minutes:resolveDeadheadMinutes.mock.calls.length===6?1:10,distanceKm:6,provenance:'live',computedAt:now.toISOString()}));
  const rec={pair:{candidates}}; await applyDispatchRadar({request,estimate:{durationMin:30,source:"TomTom"},recommendation:rec,now});
  expect(resolveDeadheadMinutes).toHaveBeenCalledTimes(6); expect(rec.pair.recommended.proximity.etaMinutes).toBe(1);
  query.mockRejectedValue(new Error('database unavailable'));
  await applyDispatchRadar({request,estimate:{durationMin:30,source:"TomTom"},recommendation:rec,now});
  expect(rec.pair.candidates.every(c=>c.feasibility.verdict==='UNKNOWN')).toBe(true);
});
it('does not invent ETA for missing GPS or a failed provider and excludes hard conflicts before routing',async()=>{
  standbyState.mockResolvedValue(null); expect((await evaluate()).proximity).toBeUndefined();
  expect(resolveDeadheadMinutes).not.toHaveBeenCalled();
  detectRequestConflicts.mockResolvedValue({conflicts:[{severity:'blocking',message:'Capacity mismatch'}],checks:[]});
  expect((await evaluate()).feasibility.verdict).toBe('INFEASIBLE'); expect(resolveDeadheadMinutes).not.toHaveBeenCalled();
});
it('keeps busy and delayed drivers out of live routing, without removing the no-GPS recommendation',async()=>{
  standbyState.mockResolvedValue({checked_in:true,consented:true,busy:true,session_live:true,standby_tracking_enabled:true,location_vehicle_id:1});
  expect((await evaluate()).dispatchContext.liveLocationUsed).toBe(false);
  standbyState.mockResolvedValue({checked_in:true,consented:true,busy:false,session_live:true,standby_tracking_enabled:true,location_source:'standby',location_vehicle_id:1,standby_latitude:14.5,standby_longitude:121,location_accuracy_m:10,location_observed_at:new Date(+now-91_000)});
  const rec={pair:{candidates:[{driver_id:1,vehicle_id:1,driver:{},vehicle:{},score:80}]}};
  await applyDispatchRadar({request,estimate:{durationMin:30,source:'TomTom'},recommendation:rec,now});
  expect(rec.pair.recommended.readiness).toBe('REVIEW_REQUIRED');
  expect(rec.pair.recommended).not.toHaveProperty('proximity');
  expect(resolveDeadheadMinutes).not.toHaveBeenCalled();
});
it('routes from a shared preceding destination and never reads current GPS',async()=>{
  query.mockResolvedValue({rows:[{dispatch_id:5,driver_id:1,vehicle_id:1,status:'In Progress',scheduled_departure:new Date(+now-30*60_000),scheduled_arrival:new Date(+now+10*60_000),dropoff_location:'NAIA'}]});
  const result=await evaluate();
  expect(result.dispatchContext.mode).toBe('REPOSITION');
  expect(result.dispatchContext.originType).toBe('PREVIOUS_TRIP_DESTINATION');
  expect(standbyState).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty('proximity');
  expect(resolveDeadheadMinutes.mock.calls[0][2].departAt.getTime()).toBe(+now+10*60_000);
});
it('protects a fixed 1 AM commitment beyond the 11 PM analysis pickup',async()=>{
  now=new Date(); now.setUTCHours(14,0,0,0); // 10 PM Manila
  request={...request,pickup_datetime:new Date(+now+60*60_000).toISOString()};
  query.mockResolvedValue({rows:[{dispatch_id:20,driver_id:1,vehicle_id:1,status:'Scheduled',scheduled_departure:new Date(+now+180*60_000),pickup_location:'Next pickup'}]});
  // Passenger trip ends at 00:50; ten-minute buffer plus five-minute travel
  // cannot protect the fixed 01:00 departure on the following calendar day.
  const result=await evaluate({estimate:{durationMin:110,source:'Manual'}});
  expect(result.feasibility.verdict).toBe('INFEASIBLE');
  expect(result.feasibility.protectedDispatchIds).toEqual([20]);
});
it('uses the tentative predecessor destination even after a long gap, without current GPS',async()=>{
  request={...request,pickup_datetime:new Date(+now+300*60_000).toISOString()};
  const tentativeCommitments=[{tentative:true,request_id:2,dispatch_id:'plan-2',driver_id:1,vehicle_id:1,status:'Scheduled',scheduled_departure:new Date(+now+30*60_000),scheduled_arrival:new Date(+now+60*60_000),dropoff_location:'Proposed destination'}];
  const result=await evaluate({tentativeCommitments});
  expect(result.dispatchContext.mode).toBe('REPOSITION');
  expect(resolveRouteEndpoints).toHaveBeenCalledWith(expect.anything(),{origin:'Proposed destination',destination:request.pickup_location});
  expect(standbyState).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty('position');
});
it('rejects tentative vehicle-only and driver-only overlaps',async()=>{
  for (const resource of [{driver_id:1,vehicle_id:2},{driver_id:2,vehicle_id:1}]) {
    const result=await evaluate({tentativeCommitments:[{...resource,tentative:true,request_id:2,dispatch_id:'plan-2',scheduled_departure:new Date(+now+70*60_000),scheduled_arrival:new Date(+now+100*60_000)}]});
    expect(result.feasibility.verdict).toBe('INFEASIBLE');
    expect(result.hardConflicts).toContainEqual(expect.objectContaining({type:'tentative_overlap'}));
  }
});
it('verifies a scheduled pair with no adjacent trips instead of warning',async()=>{
  const result=await evaluate({request:{...request,pickup_datetime:new Date(+now+86400_000).toISOString()}});
  expect(result.dispatchContext.mode).toBe('SCHEDULED');
  expect(result.feasibility.verdict).toBe('SAFE');
  expect(result.feasibility.reasons.join(' ')).toMatch(/No adjacent trips/);
  expect(result.feasibility.reasons.join(' ')).not.toMatch(/Scheduled planning/);
  expect(result.readiness).toBe('VERIFIED');
});
it('names the unverified turnaround dispatch instead of a generic planning warning',async()=>{
  const pickupAt=new Date(+now+86400_000);
  query.mockResolvedValue({rows:[{dispatch_id:21,driver_id:1,vehicle_id:1,status:'Scheduled',scheduled_departure:new Date(+pickupAt+120*60_000).toISOString(),pickup_location:'Far pickup'}]});
  resolveDeadheadMinutes.mockImplementationOnce(async()=>({minutes:null,provenance:'unknown',computedAt:now.toISOString()}));
  const result=await evaluate({request:{...request,pickup_datetime:pickupAt.toISOString()}});
  expect(result.dispatchContext.mode).toBe('SCHEDULED');
  expect(result.feasibility.verdict).toBe('UNKNOWN');
  expect(result.feasibility.reasons.join(' ')).toMatch(/Unverified turnaround before dispatch #21/);
  expect(result.feasibility.reasons.join(' ')).not.toMatch(/Scheduled planning/);
});
