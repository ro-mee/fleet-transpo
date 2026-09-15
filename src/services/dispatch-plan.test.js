import { it, expect, vi } from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn()}));
vi.mock('@/services/dispatch-settings.service',()=>({getDispatchPolicy:vi.fn(async()=>({}))}));
vi.mock('@/services/dispatch-recommendation-preparation.service',()=>({prepareDispatchRecommendation:vi.fn()}));
vi.mock('@/services/dispatch-radar.service',()=>({evaluateDispatchCandidate:vi.fn(),serviceEnd:(r,e)=>new Date(+new Date(r.pickup_datetime)+e.durationMin*60_000)}));
import { planPreparedRequests, manilaWindowEnd, planPriority, buildDispatchPlan } from './dispatch-plan.service';
import { query } from '@/lib/db';
import { prepareDispatchRecommendation } from '@/services/dispatch-recommendation-preparation.service';
const now=new Date('2026-09-14T02:00:00Z');
const pair=id=>({driver_id:id,vehicle_id:id,driver:{driver_name:`Driver ${id}`},vehicle:{plate_number:`ABC ${id}`}});
const row=(id,ids,start=60)=>({request:{request_id:id,fleet_status:'Pending',derived_priority:'High',pickup_datetime:new Date(+now+start*60_000).toISOString(),pickup_location:'A',dropoff_location:'B'},estimate:{durationMin:30,source:'Manual'},candidates:ids.map(pair)});
const safe={readiness:'VERIFIED',feasibility:{verdict:'SAFE',deadheadMin:5,reasons:['Verified legs.']}};
it('pins a chosen alternative and requires explicit review evidence for a manual choice',async()=>{
 const selection={requestId:1,vehicleId:2,driverId:2};
 const pinned=await planPreparedRequests([row(1,[1,2]),row(2,[3],120)],{now,evaluate:evaluator,selection});
 expect(pinned.proposals[0].pair.vehicle_id).toBe(2);
 const review={readiness:'REVIEW_REQUIRED',feasibility:{verdict:'UNKNOWN',reasons:['Departure arrangements need review']},reviewable:true,checks:[{status:'verified'}]};
 const manual=await planPreparedRequests([row(1,[2])],{now,evaluate:()=>review,selection});
 expect(manual.proposals[0].confirmationMode).toBe('manual');
 expect(manual.servedCount).toBe(0);
 const missing=await planPreparedRequests([row(1,[2])],{now,evaluate:()=>({...review,checks:[{status:'missing'}]}),selection});
 expect(missing.proposals[0].confirmationMode).not.toBe('manual');
});
function evaluator({request,vehicleId,driverId,tentativeCommitments}) {
 const collides=tentativeCommitments.some(c=>String(c.request_id)!==String(request.request_id)
   && (c.vehicle_id===vehicleId||c.driver_id===driverId)
   && +new Date(c.scheduled_departure)<+new Date(request.pickup_datetime)+30*60_000
   && +new Date(c.scheduled_arrival)>+new Date(request.pickup_datetime));
 return collides?{readiness:'REVIEW_REQUIRED',feasibility:{verdict:'INFEASIBLE',reasons:['Overlap']}}:safe;
}
it('preserves scarce pairs: flexible A takes 2 and constrained B takes 1',async()=>{
 const a=row(1,[1,2]),b=row(2,[1]);a.request.derived_priority='Critical';
 const result=await planPreparedRequests([a,b],{now,evaluate:evaluator});
 expect(result.servedCount).toBe(2);expect(result.proposals.map(r=>r.pair.vehicle_id)).toEqual([2,1]);
});
it('checks vehicle and driver separately and never counts UNKNOWN as served',async()=>{
 const a=row(1,[1]),b=row(2,[2]);b.candidates[0].driver_id=1;
 const result=await planPreparedRequests([a,b],{now,evaluate:evaluator});
 expect(result.servedCount).toBe(1);expect(result.proposals[1].outcome).toBe('HARD_CONFLICT');
 const unknown=await planPreparedRequests([a],{now,evaluate:()=>({readiness:'REVIEW_REQUIRED',feasibility:{verdict:'UNKNOWN'}})});
 expect(unknown.servedCount).toBe(0);expect(unknown.proposals[0].outcome).toBe('REVIEW_REQUIRED');
});
it('returns deterministic proposal order and compares routed travel before fairness',async()=>{
 const a=row(1,[1,2]);a.candidates[0].fairness_score=100;
 const evaluate=({vehicleId})=>({...safe,feasibility:{...safe.feasibility,deadheadMin:vehicleId===2?1:8}});
 const first=await planPreparedRequests([a,row(2,[],120)],{now,evaluate});
 const second=await planPreparedRequests([row(2,[],120),{...a,candidates:[...a.candidates].reverse()}],{now,evaluate});
 expect(first).toEqual(second);expect(first.proposals[0].pair.vehicle_id).toBe(2);
});
it('revalidates prior outgoing legs and does not publish a standalone SAFE pair as selected when prior fails',async()=>{
 const evaluate=args=>args.tentativeCommitments.length>1 && args.request.request_id===1
   ?{readiness:'REVIEW_REQUIRED',feasibility:{verdict:'INFEASIBLE'}}:safe;
 const result=await planPreparedRequests([row(1,[1]),row(2,[1],120)],{now,evaluate});
 expect(result.servedCount).toBe(1);expect(result.proposals[1].outcome).toBe('REVIEW_REQUIRED');
});
it('shares global routing state and declares deadline omissions',async()=>{
 const memo=new Map(),deadline=Date.now()+10000,evaluate=vi.fn(()=>safe);
 await planPreparedRequests([row(1,[1]),row(2,[2])],{now,evaluate,deadline,routeMemo:memo});
 expect(evaluate.mock.calls.every(([arg])=>arg.deadline===deadline&&arg.routeMemo===memo)).toBe(true);
 const result=await planPreparedRequests([row(1,[1])],{now,deadline:0,evaluate});
 expect(result.incompleteReason).toBe('DEADLINE');expect(result.evaluatedRequests).toBe(0);expect(result.proposals[0].outcome).toBe('NOT_EVALUATED');
});
it('makes later shared-resource proposals dependent and preserves destination overlay',async()=>{
 const evaluate=vi.fn(evaluator);
 const result=await planPreparedRequests([row(1,[1]),row(2,[1],120)],{now,evaluate});
 expect(result.proposals[1].dependsOnRequestIds).toEqual([1]);
 expect(evaluate.mock.calls.at(-1)[0].tentativeCommitments[0]).toMatchObject({dropoff_location:'B',tentative:true,driver_id:1,vehicle_id:1});
});
it('uses Manila day boundaries and derived priority',()=>{
 expect(planPriority({pickup_datetime:null,fleet_status:'Pending'},now)).toBe('Future');
 expect(manilaWindowEnd(new Date('2026-09-14T17:00:00Z'))).toBe('2026-09-15T16:00:00.000Z');
 expect(planPriority({pickup_datetime:'2026-09-14T15:00:00Z',fleet_status:'Pending'},new Date('2026-09-14T01:00:00Z'))).toBe('Normal');
 expect(planPriority({pickup_datetime:'2026-09-14T00:00:00Z',fleet_status:'Pending'},now)).toBe('Overdue');
});
it('reports server totals above cap without reading any client page',async()=>{
 const metadata=Array.from({length:31},(_,i)=>({...row(i+1,[]).request}));
 query.mockResolvedValueOnce({rows:metadata}).mockResolvedValueOnce({rows:metadata.slice(0,30)});
 prepareDispatchRecommendation.mockImplementation(async request=>({request,estimate:{durationMin:30},recommendation:{pair:{candidates:[]}}}));
 const result=await buildDispatchPlan({now});
 expect(result.totalRequests).toBe(31);expect(result.proposals).toHaveLength(30);expect(result.analysisComplete).toBe(false);expect(result.incompleteReason).toBe('REQUEST_CAP');
 expect(query.mock.calls[0][0]).toContain('tr.pickup_datetime IS NULL');
});
it('does not sacrifice a higher priority request for fairness or lower-priority coverage',async()=>{
 const high=row(1,[1]),low=row(2,[1]);high.request.derived_priority='Critical';low.request.derived_priority='Normal';low.candidates[0].fairness_score=100;
 const result=await planPreparedRequests([low,high],{now,evaluate:evaluator});
 expect(result.proposals.find(p=>p.requestId===1).outcome).toBe('VERIFIED');
 expect(result.proposals.find(p=>p.requestId===2).outcome).toBe('HARD_CONFLICT');
});
it('repeated analysis uses only SELECTs and disables snapshot/route persistence',async()=>{
 const request=row(1,[]).request;
 query.mockReset();query.mockImplementation(async sql=>{expect(sql.trim()).toMatch(/^SELECT/);return {rows:[request]};});
 prepareDispatchRecommendation.mockImplementation(async r=>({request:r,estimate:{durationMin:30},recommendation:{pair:{candidates:[]}}}));
 const first=await buildDispatchPlan({now}),second=await buildDispatchPlan({now});
 expect(first).toEqual(second);
 expect(prepareDispatchRecommendation).toHaveBeenLastCalledWith(expect.objectContaining({request_id:1}),{now,persistRoute:false});
});
it('downgrades an expired predecessor and all dependent proposals',async()=>{
 const clock=Date.now();
 const evaluate=({request})=>({...safe,evidenceExpiresAt:new Date(request.request_id===1?clock-1:clock+60000).toISOString()});
 const result=await planPreparedRequests([row(1,[1]),row(2,[1],120)],{now,evaluate});
 expect(result.servedCount).toBe(0);
 expect(result.proposals.every(p=>p.outcome==='REVIEW_REQUIRED')).toBe(true);
});
