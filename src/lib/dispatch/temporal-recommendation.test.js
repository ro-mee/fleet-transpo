import { expect, it } from 'vitest';
import { requestLocationContext } from './location-relevance';
import { DEFAULT_DISPATCH_POLICY } from '@/lib/dispatch-policy';
import { rankDispatchPairs } from './recommendation-ranking';
import { parseCopilotIntent } from './conversation';
import { deriveOptions } from '@/components/reservations/copilot-options';
const now = new Date('2026-09-15T10:00:00Z');
const request = minutes => ({fleet_status:'Pending',pickup_datetime:new Date(+now+minutes*60_000).toISOString()});
const pair = (id,gap,trips,transfer=10) => ({vehicle_id:id,driver_id:id,checks:[{status:'verified'}],evaluated:true,
  readiness:gap-transfer-10>=10 ? 'VERIFIED' : 'REVIEW_REQUIRED',
  feasibility:{verdict:gap-transfer-10>=10 ? 'SAFE' : gap-transfer-10>=0 ? 'TIGHT' : 'INFEASIBLE'},
  scheduleEvidence:{gapMinutes:gap,transferMinutes:transfer,usableSlackMinutes:gap-transfer-10},
  workloadEvidence:trips == null ? null : {serviceDate:'2026-09-18',complete:true,totalTrips:trips}});
it('uses temporal precedence, Manila midnight and configured boundaries',()=>{
  for (const [minutes,horizon] of [[-1,'OVERDUE'],[0,'LAST_MINUTE'],[30,'LAST_MINUTE'],[30.01,'NEAR_DISPATCH'],[90,'NEAR_DISPATCH'],[91,'SAME_DAY'],[4320,'FUTURE']])
    expect(requestLocationContext(request(minutes),now).horizon).toBe(horizon);
  const midnight=new Date('2026-09-15T15:50:00Z');
  expect(requestLocationContext({fleet_status:'Pending',pickup_datetime:'2026-09-15T16:10:00Z'},midnight).horizon).toBe('LAST_MINUTE');
  expect(requestLocationContext(request(70),now,null,{...DEFAULT_DISPATCH_POLICY,shortNoticeHorizonMinutes:60}).horizon).toBe('SAME_DAY');
  expect(requestLocationContext(request(90),now).nextBoundaryAt).toBe('2026-09-15T11:00:00.000Z');
  expect(requestLocationContext({...request(20),fleet_status:'Cancelled'},now).horizon).toBe('INACTIVE');
});
it('prefers reliability when tight; workload when both sufficient; never infers missing workload',()=>{
  expect(rankDispatchPairs([pair(1,95,5),pair(2,20,2)])[0].vehicle_id).toBe(1);
  for (const gap of [85,70]) {
    const ranked=rankDispatchPairs([pair(1,105,5),pair(2,gap,2)]);
    expect(ranked[0].vehicle_id).toBe(2);expect(ranked[0].decisionEvidence.code).toBe('WORKLOAD');
  }
  expect(rankDispatchPairs([pair(1,105,5,100),pair(2,70,2)])[0].vehicle_id).toBe(2);
  expect(rankDispatchPairs([pair(1,95,5),pair(2,85,null)])[0].decisionEvidence.code).not.toBe('WORKLOAD');
  expect(rankDispatchPairs([pair(1,95,5),{...pair(2,85,2),advisories:[{message:'Maintenance review'}]}])[0].vehicle_id).toBe(1);
});
it('only exact commands act and pinned option identity survives refresh/removal',()=>{
  expect(parseCopilotIntent('Assign it.')).toEqual({type:'assign'});
  expect(parseCopilotIntent('choose option B')).toEqual({type:'choose',index:1});
  for (const text of ['Option 2','2','I choose option 2','option B na lang','pipiliin ko option 2'])
    expect(parseCopilotIntent(text)).toEqual({type:'choose',index:1});
  for (const text of ['Why option 2?','Do not choose option 2','"Option 2"','Option 1 or 2','Option 2?']) expect(parseCopilotIntent(text)).toBeNull();
  for (const text of ['Why assign it?','"assign it"','Do not assign it','The AI said assign it','assign it?']) expect(parseCopilotIntent(text)).toBeNull();
  const a=pair(1,95,5),b=pair(2,85,2);
  const options=deriveOptions({candidates:[b],recommended:b,pinnedKeys:['1:1','2:2']});
  expect(options[0].pair).toMatchObject({vehicle_id:1,unavailable:true});
  expect(options[1].pair).toBe(b);
  expect(deriveOptions({candidates:[a],proposalPair:{...a,readiness:'REVIEW_REQUIRED'}})[0].pair.readiness).toBe('REVIEW_REQUIRED');
});
