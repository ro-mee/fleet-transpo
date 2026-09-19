import {it,expect} from 'vitest';
import {dispatchDecision,dispatchConfirmation,isFuelNoise} from './decision';
const safe={checks:[{id:'capacity',status:'verified'}],readiness:'VERIFIED',evaluated:true,feasibility:{verdict:'SAFE'},reviewable:true};
const now=Date.parse('2026-09-15T00:00:00Z');
const ready={canAssign:true,pair:safe,decision:dispatchDecision(safe),now};
const queue={plan:{expiresAt:new Date(now+60_000).toISOString()},proposal:{outcome:'VERIFIED'},token:'signed',validation:{isSuccess:true}};
it('preserves confirmation gates while giving each disabled state a recovery reason',()=>{
 expect(dispatchConfirmation(ready).canSubmit).toBe(true);
 for(const change of [
   {awaitingResult:true},{error:true},{pending:true},{canAssign:false},{pair:null},
   {failure:{message:'Conflict'}},{failure:{checking:true}},
   {decision:dispatchDecision({...safe,hardConflicts:[{message:'Overlap'}]})},
   {decision:dispatchDecision({...safe,checks:[]})},
   {decision:dispatchDecision({...safe,evidenceExpiresAt:'2020-01-01'})},
 ]) {
   const state=dispatchConfirmation({...ready,...change});
   expect(state.canSubmit).toBe(false);
   expect(state.message.length).toBeGreaterThan(0);
 }
 expect(dispatchConfirmation({...ready,failure:{checking:true}}).recovery).toBe('request');
 expect(dispatchConfirmation({...ready,awaitingResult:true}).recovery).toBeNull();
 // A background refresh is not a gate. `isFetching` is the wrong signal for
 // "nothing to act on yet", and passing it must not disable Assign.
 expect(dispatchConfirmation({...ready,fetching:true}).canSubmit).toBe(true);
 // An in-flight first load must never mask a known blocker — the error/stale
 // reason outranks the loading label.
 expect(dispatchConfirmation({...ready,awaitingResult:true,error:true}).message)
   .toBe('Current evidence is unavailable or expired. Recheck this reservation.');
 expect(dispatchConfirmation({...ready,awaitingResult:true,decision:dispatchDecision({...safe,evidenceExpiresAt:'2020-01-01'})}).message)
   .toBe('Current evidence is unavailable or expired. Recheck this reservation.');
});
it('requires a current verified independent queue proposal and does not gate individual mode on a queue',()=>{
 expect(dispatchConfirmation({...ready,queue}).canSubmit).toBe(true);
 for(const change of [
   {plan:null},{plan:{expiresAt:'invalid'}},{plan:{expiresAt:new Date(now).toISOString()}},
   {proposal:null},{proposal:{outcome:'REVIEW_REQUIRED'}},
   {proposal:{outcome:'VERIFIED',dependsOnRequestIds:[2]}},{token:null},
   {invalidReason:'Analysis failed'},{analyzing:true},{validation:{isSuccess:false}},
   {validation:{isError:true}},
 ]) expect(dispatchConfirmation({...ready,queue:{...queue,...change}}).canSubmit).toBe(false);
 expect(dispatchConfirmation({...ready,queue:null}).canSubmit).toBe(true);
 // The validation poll runs every 10s. A poll landing on a current successful
 // validation is a background refresh and must not disable Assign; plan expiry,
 // invalidation, the signed token and the server stay authoritative instead.
 expect(dispatchConfirmation({...ready,queue:{...queue,validation:{isSuccess:true,isFetching:true}}}).canSubmit).toBe(true);
});
it('does not let queue validation hide stale or failed recommendation evidence',()=>{
 const unavailable = 'Current evidence is unavailable or expired. Recheck this reservation.';
 expect(dispatchConfirmation({...ready,error:true,queue:{...queue,validation:{isSuccess:false}}}).message).toBe(unavailable);
 expect(dispatchConfirmation({...ready,decision:{...ready.decision,stale:true},queue:{...queue,validation:{isSuccess:false}}}).message).toBe(unavailable);
});
it('requires a reason for reviewable evidence and never overrides a hard blocker',()=>{
 const review={...ready,decision:dispatchDecision({...safe,feasibility:{verdict:'UNKNOWN'}})};
 expect(dispatchConfirmation({...review,reason:' '}).canSubmit).toBe(false);
 expect(dispatchConfirmation({...review,reason:'Driver confirmed the route'}).canSubmit).toBe(true);
 expect(dispatchConfirmation({...review,reason:'Override',decision:dispatchDecision({...safe,hardConflicts:[{message:'Overlap'}]})}).canSubmit).toBe(false);
});
it('requires positive coverage, preserves blocking precedence and never treats score as safety',()=>{
 expect(dispatchDecision(safe).state).toBe('ALL_CLEAR');
 expect(dispatchDecision({...safe,checks:[],confidence:1}).state).toBe('INSUFFICIENT_DATA');
 expect(dispatchDecision({...safe,checks:[{status:'missing'}],hardConflicts:[{severity:'blocking',message:'Overlap'}]}).state).toBe('BLOCKED');
 expect(dispatchDecision({...safe,hardConflicts:[{severity:'blocking',reviewable:true}],feasibility:{verdict:'UNKNOWN'}}).state).toBe('INSUFFICIENT_DATA');
  expect(dispatchDecision({...safe,feasibility:{verdict:'TIGHT'}}).state).toBe('REVIEW_REQUIRED');
  expect(dispatchDecision({...safe,advisories:[{message:'Policy warning'}]}).state).toBe('ALL_CLEAR');
 expect(dispatchDecision({...safe,vehicle:{maintenance:{risk:'high',basis:'date'}}}).state).toBe('REVIEW_REQUIRED');
 expect(dispatchDecision({...safe,evaluated:false}).canConfirm).toBe(false);
 expect(dispatchDecision({...safe,evidenceExpiresAt:'2020-01-01'}).canReview).toBe(false);
  expect(dispatchDecision({...safe,dispatchContext:{reasonCode:'STANDBY_NOT_VERIFIED'}}).canReview).toBe(false);
  expect(dispatchDecision({...safe,checks:[{status:'missing'}]}).canReview).toBe(false);
});
it('filters fuel noise out of reasons while keeping other advisories visible',()=>{
  expect(isFuelNoise('Fuel at 10% — refuel before departure.')).toBe(true);
  expect(isFuelNoise('Fuel at 40% — may need a top-up en route.')).toBe(true);
  expect(isFuelNoise('Sufficient fuel level')).toBe(true);
  expect(isFuelNoise('Policy warning')).toBe(false);
  expect(isFuelNoise(null)).toBe(false);
  const d = dispatchDecision({...safe,advisories:[{message:'Fuel at 10% — refuel before departure.'},{message:'Check assignment'}]});
  expect(d.state).toBe('ALL_CLEAR');
  expect(d.reasons).toEqual(['Check assignment']);
});
