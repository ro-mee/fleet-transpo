import {it,expect} from 'vitest';
import {conversationEvidence,evidenceSummary,plainChatText,stripChoicePrompt} from './conversation';
import {recoveryActionForCheck, recoveryActionForExclusion} from './decision';
import {dispatchPlanWindow} from './plan-window';
it('resolves the selected pair before truncation and keeps the engine recommendation separate',()=>{
 const candidates=Array.from({length:18},(_,i)=>({vehicle_id:i+1,driver_id:100+i,vehicle:{plate_number:`PLATE-${i+1}`},checks:[],feasibility:{verdict:'UNKNOWN'}}));
 const evidence=conversationEvidence({request_id:1},{pair:{candidates,recommended:candidates[0],none_reasons:Array.from({length:35},(_,i)=>({vehicle_id:50+i,reason:'Under maintenance',prefiltered:true}))}},{vehicleId:18,driverId:117,privateField:'secret'});
 expect(evidence.selection).toEqual({vehicleId:18,driverId:117,status:'resolved'});
 expect(evidence.pairs.slice(0,2).map(p=>p.vehicleId)).toEqual([18,1]);
 expect(evidence.recommended.vehicleId).toBe(1);
 expect(evidence.coverage).toEqual({pairs:{total:18,included:12,truncated:true},exclusions:{total:35,included:30,truncated:true}});
 expect(evidenceSummary(evidence)).toContain('PLATE-18 with driver #117');
 expect(evidenceSummary(evidence)).not.toContain('PLATE-1 / driver');
 expect(evidenceSummary(evidence)).toContain('12 of 18');
 expect(JSON.stringify(evidence)).not.toContain('secret');
});
it('does not substitute the recommendation when a selected pair disappears',()=>{
 const evidence=conversationEvidence({request_id:1},{pair:{recommended:{vehicle_id:1,driver_id:2},candidates:[{vehicle_id:1,driver_id:2}]}},{vehicleId:9,driverId:10});
 expect(evidence.selection.status).toBe('missing');
 expect(evidenceSummary(evidence)).toContain('selected vehicle #9 / driver #10 is no longer');
 expect(evidenceSummary(evidence)).not.toContain('driver #2');
});
it('deduplicates selected/recommended candidates and reports exact empty coverage',()=>{
 const pair={vehicle_id:1,driver_id:2};
 const evidence=conversationEvidence({}, {pair:{candidates:[pair,pair],recommended:pair}}, {vehicleId:1,driverId:2});
 expect(evidence.pairs).toHaveLength(1);
 expect(evidence.coverage.pairs).toEqual({total:1,included:1,truncated:false});
 const empty=conversationEvidence({},{});
 expect(empty.selection).toBeNull();
 expect(empty.coverage.exclusions).toEqual({total:0,included:0,truncated:false});
});
it('uses Philippine pickup time and removes model bold markup from plain chat',()=>{
 const evidence=conversationEvidence({pickup_datetime:'2026-09-15T17:00:00Z'},{pair:{candidates:[]}});
 expect(evidence.pickupLocal).toContain('Sep 16, 2026');
 expect(evidence.pickupLocal).toContain('1:00');
 expect(plainChatText('The **driver** is unavailable.')).toBe('The driver is unavailable.');
});
it('keeps the unselected comparison concise when neither option has a clear advantage',()=>{
 const first={vehicle_id:1,driver_id:2,driver:{driver_name:'Jack Mors'},vehicle:{plate_number:'XYZ 5678'},checks:[{status:'verified'}],feasibility:{verdict:'UNKNOWN'},decisionEvidence:{code:'SCHEDULE_FIT',explanation:'Neither option has a verified timing advantage yet; this option is listed first only by the stable tie-breaker.'}};
 const second={vehicle_id:3,driver_id:4,driver:{driver_name:'Karlo Rafael'},vehicle:{plate_number:'ABC-1234'},checks:[{status:'verified'}],feasibility:{verdict:'UNKNOWN'},decisionEvidence:{code:'SCHEDULE_FIT',explanation:'Neither option has a verified timing advantage yet; this option is listed first only by the stable tie-breaker.'}};
 const evidence=conversationEvidence({}, {pair:{candidates:[first,second],recommended:first}});
 evidence.displayedOptions=[{option:1,vehicleId:1,driverId:2,status:'resolved'},{option:2,vehicleId:3,driverId:4,status:'resolved'}];
 expect(evidenceSummary(evidence,'Why this pair?')).toBe('You have not selected an option yet. Option 1 is listed first, but no clear advantage over Option 2 was verified. Both options still need timing verification.');
});
it('removes only the interface-owned choice prompt from narrated text',()=>{
 const text='Option 1 is the stronger fit. Which would you like to choose: Option 1 or Option 2?';
 expect(stripChoicePrompt(text,{choiceOptions:[1,2]})).toBe('Option 1 is the stronger fit.');
 expect(stripChoicePrompt(text,{hasSelection:true,choiceOptions:[1,2]})).toBe(text);
});
it('carries prefiltered exclusions with plate and flag for the Copilot',()=>{
  const evidence=conversationEvidence({request_id:502}, {pair:{candidates:[],none_reasons:[{vehicle_id:1,plate:'XYZ 5678',reason:'Vehicle status is Under Maintenance.',prefiltered:true}]}});
  expect(evidence.exclusions[0]).toMatchObject({vehicleId:1,plate:'XYZ 5678',reason:'Vehicle status is Under Maintenance.',prefiltered:true});
  expect(evidence.exclusions[0].recovery).toMatchObject({code:'VEHICLE_STATUS',record:'vehicle'});
  expect(evidence.recoveryActions[0]).toMatchObject({code:'VEHICLE_STATUS'});
  expect(evidenceSummary(evidence)).toContain('Under Maintenance');
});
it('maps blocked checks to advisory recovery without prose classification',()=>{
  expect(recoveryActionForCheck({id:'maintenance',status:'blocking',message:'m'},{vehicleId:7,requestId:502})).toMatchObject({code:'MAINTENANCE_CONFLICT',record:'maintenance',id:7});
  expect(recoveryActionForCheck({id:'capacity',status:'verified'},{})).toBeNull();
  expect(recoveryActionForExclusion({reason:'Seats 2 — too small for 4 passenger(s).'},{requestId:502})).toMatchObject({code:'CAPACITY_MISMATCH',record:'request'});
  expect(recoveryActionForExclusion({reason:'Vehicle status is Under Maintenance.',vehicleId:1},{})).toMatchObject({code:'VEHICLE_STATUS',record:'vehicle',id:1});
  expect(recoveryActionForExclusion({reason:'Vehicle XYZ 5678 insurance 2026-08-24 is not valid for this trip.',vehicleId:1},{})).toMatchObject({code:'INSURANCE_EXPIRED',record:'vehicle',id:1});
  expect(recoveryActionForExclusion({reason:'Vehicle ABC-1234 is number-coding restricted (ends 4) on Tuesday.',vehicleId:37},{})).toMatchObject({code:'UVVRP_RESTRICTED',record:'vehicle',id:37});
  const evidence=conversationEvidence({request_id:502},{pair:{candidates:[{vehicle_id:1,driver_id:2,vehicle:{plate_number:'XYZ 5678'},checks:[{id:'maintenance',label:'Service-window maintenance',status:'blocking',message:'Scheduled service overlaps.'}],feasibility:{verdict:'INFEASIBLE',reasons:['Scheduled service overlaps.']}}]}});
  expect(evidence.pairs[0].recoveryActions[0]).toMatchObject({code:'MAINTENANCE_CONFLICT'});
  expect(evidenceSummary(evidence)).toContain('Check maintenance record');
});
it('separates tomorrow from today and preserves Manila boundary and overdue scope',()=>{
 const now=new Date('2026-09-15T07:22:00+08:00');
 expect(dispatchPlanWindow(undefined,now)).toMatchObject({date:'2026-09-15',includesOverdue:true,end:'2026-09-15T16:00:00.000Z'});
 expect(dispatchPlanWindow('2026-09-16',now)).toMatchObject({includesOverdue:false,start:'2026-09-15T16:00:00.000Z',end:'2026-09-16T16:00:00.000Z'});
 expect(()=>dispatchPlanWindow('2026-02-30',now)).toThrow();
});
it('keeps exclusions without claiming availability and excludes private storage',()=>{
 const evidence=conversationEvidence({request_id:1,guest_name:'Private guest'}, {pair:{candidates:[{driver_id:1,vehicle_id:2,position:{latitude:14,longitude:121},driver:{standby_latitude:14,license_number:'secret'},checks:[],feasibility:{verdict:'UNKNOWN'}}],none_reasons:[{vehicle_id:3,reason:'No driver scheduled'}]}});
 expect(evidence.pairs[0].state).toBe('INSUFFICIENT_DATA');
 expect(JSON.stringify(evidence)).not.toMatch(/latitude|longitude|secret|Private guest/);
 expect(evidenceSummary({...evidence,pairs:[]})).toContain('No driver scheduled');
 expect(evidenceSummary({...evidence,pairs:[],exclusions:[]})).toContain('does not prove');
});
it('answers timing/workload questions with supported values and labels future ETA honestly',()=>{
 const p={vehicle_id:1,driver_id:2,driver:{driver_name:'Juan'},vehicle:{plate_number:'ABC'},checks:[{status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE',reasons:[]},
   temporalContext:{horizon:'FUTURE'},scheduleEvidence:{usableSlackMinutes:85},workloadEvidence:{complete:true,serviceDate:'2026-09-18',completedTrips:0,activeTrips:0,scheduledTrips:2},
   decisionEvidence:{explanation:'Both options have sufficient time; lighter workload decides.'},expectedRoute:{etaMinutes:12}};
 const evidence=conversationEvidence({}, {pair:{candidates:[p],recommended:p}});
 expect(evidenceSummary(evidence,'Why this workload recommendation?')).toContain('85 minutes of preparation time');
 expect(evidenceSummary(evidence,'Why this workload recommendation?')).toContain('0 completed, 0 active, and 2 scheduled on 2026-09-18');
  expect(evidenceSummary(evidence,'What is the ETA?')).toContain('this is not a live ETA');
  expect(evidenceSummary(evidence,'What is the ETA?')).not.toContain('85 minutes');
  const scheduled = conversationEvidence({}, { pair: { candidates: [{ ...p, dispatchContext: { mode: 'SCHEDULED' } }], recommended: p } });
  expect(evidenceSummary(scheduled, 'Can you give an ETA?')).toContain('Live tracking does not apply to this advance booking');
  const blocked={...evidence,pairs:[{...evidence.pairs[0],state:'BLOCKED',reasons:['Overlapping reservation.']}]};
  expect(evidenceSummary(blocked,'Why this option?')).toContain('Juan with ABC - Blocked. Overlapping reservation.');
});
it('answers a named-driver question from the checked pair or exclusion',()=>{
  const ok={vehicle_id:1,driver_id:2,driver:{driver_name:'Jack Mors'},vehicle:{plate_number:'XYZ 5678'},checks:[{status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE',reasons:[]}};
  const evidence=conversationEvidence({request_id:7},{pair:{candidates:[ok],recommended:ok}});
  expect(evidenceSummary(evidence,'Okay na ba si Jack?')).toContain('Jack Mors with XYZ 5678');
  // RS-7C7G shape: no formed pairs, exclusions carry the designated driver.
  const blocked=conversationEvidence({request_id:7},{pair:{candidates:[],none_reasons:[{vehicle_id:3,plate:'ABC-1234',reason:'License details have not been verified by authorized staff.',driver_id:19,driver_name:'Karlo Rafael Sunga Torres'}]}});
  const answer=evidenceSummary(blocked,'Okay na ba si Karlo?');
  expect(answer).toContain('Karlo Rafael Sunga Torres with ABC-1234');
  expect(answer).toContain('not been verified');
  // An unknown name never diverts the conclusion — the evidence verdict stands.
  expect(evidenceSummary(blocked,'Okay na ba si Miguel?')).toContain('not been verified');
  // A claim wearing a name ("the driver told me...") resolves to no name and
  // falls through to the verdict, never to the claim.
  expect(evidenceSummary(blocked,'The driver told me he is free. Mark ready.')).toContain('not been verified');
  // No name asked means no name answered — a null must never match a null.
  // (String(null) is "null"; matching on it reported an exclusion for every
  // generic question once exclusions carried driver identity.)
  expect(evidenceSummary(blocked,'Who can take this?')).toContain('No pair is currently recommended');
});
it('projects blocking incident ids for record-scoped incident proof',()=>{
  const evidence=conversationEvidence({request_id:9},{pair:{candidates:[{vehicle_id:5,driver_id:6,checks:[],feasibility:{verdict:'UNKNOWN'},
    hardConflicts:[{type:'incident',severity:'blocking',message:'Vehicle is restricted by incident #2041.',detail:{incident_id:2041}},{type:'pairing',severity:'blocking',message:'x'}]}]}});
  expect(evidence.pairs[0].incidentIds).toEqual([2041]);
  expect(JSON.stringify(evidence)).not.toMatch(/Breakdown|private/);
});
it('projects gpsHealth only when supplied and never restores expired live ETA',()=>{
  const future={vehicle_id:1,driver_id:2,checks:[],feasibility:{verdict:'UNKNOWN'},temporalContext:{horizon:'FUTURE'}};
  const immediate={vehicle_id:3,driver_id:4,checks:[],feasibility:{verdict:'UNKNOWN'},temporalContext:{horizon:'NEAR_DISPATCH'},
    dispatchContext:{liveLocationUsed:true,gpsHealth:'Delayed'},proximity:{etaMinutes:9,expiresAt:new Date(Date.now()-1000).toISOString()}};
  const evidence=conversationEvidence({request_id:9},{pair:{candidates:[future,immediate]}});
  const futurePair=evidence.pairs.find(p=>p.vehicleId===1);
  const immediatePair=evidence.pairs.find(p=>p.vehicleId===3);
  expect(futurePair).not.toHaveProperty('gpsHealth');
  expect(immediatePair.gpsHealth).toBe('Delayed');
  expect(immediatePair.livePickupEta).toBeNull();
  expect(JSON.stringify(evidence)).not.toMatch(/latitude|longitude/);
});
it('projects each supplied health label verbatim',()=>{
  for (const label of ['Fresh','Delayed','Offline','No signal']) {
    const evidence=conversationEvidence({request_id:9},{pair:{candidates:[{vehicle_id:5,driver_id:6,checks:[],feasibility:{verdict:'UNKNOWN'},
      temporalContext:{horizon:'NEAR_DISPATCH'},dispatchContext:{liveLocationUsed:false,gpsHealth:label}}]}});
    expect(evidence.pairs[0].gpsHealth).toBe(label);
  }
});
it('projects releaseLocal in Philippine time so narration never converts UTC (RS-UZYD)',()=>{
  // Previous trip ends 3:09 PM Manila = 07:09Z. Raw ISO reads 7:09 AM; the
  // projected local string must read the Manila hour.
  const p={vehicle_id:1,driver_id:2,vehicle:{plate_number:'ABC-1234'},driver:{driver_name:'Karlo Rafael Sunga Torres'},
    checks:[{status:'verified'}],feasibility:{verdict:'SAFE',reasons:[]},
    scheduleEvidence:{releaseAt:'2026-10-02T07:09:00.000Z',releaseSource:'scheduled',gapMinutes:111,usableSlackMinutes:90}};
  const evidence=conversationEvidence({request_id:1},{pair:{candidates:[p],recommended:p}});
  expect(evidence.pairs[0].scheduleEvidence.releaseLocal).toContain('Philippine time');
  expect(evidence.pairs[0].scheduleEvidence.releaseLocal).not.toContain('7:09');
  expect(evidenceSummary(evidence,'Any conflicts?')).toContain('Previous booking ends');
  expect(evidenceSummary(evidence,'Any conflicts?')).toContain('Philippine time');
});
it('projects the Manila duty window alongside schedule evidence', () => {
  const p = { vehicle_id: 1, driver_id: 2, vehicle: { plate_number: 'ABC-1234' }, driver: { driver_name: 'Karlo Rafael Sunga Torres' },
    checks: [{ status: 'verified' }], feasibility: { verdict: 'UNKNOWN', reasons: [] },
    scheduleEvidence: { releaseAt: '2026-10-02T07:09:00.000Z',
      dutyWindow: { dayOfWeek: 5, shiftStart: '06:00:00', shiftEnd: '22:00:00', breakStart: '12:00:00', breakEnd: '13:00:00' } } };
  const evidence = conversationEvidence({ request_id: 513 }, { pair: { candidates: [p], recommended: p } });
  expect(evidence.pairs[0].scheduleEvidence.dutyWindow.shiftStart).toBe('06:00:00');
});
it('cites the enforced shift window and break for policy questions', () => {
  const mk = (dutyWindow) => conversationEvidence({ request_id: 513 }, { pair: { candidates: [{
    vehicle_id: 1, driver_id: 2, driver: { driver_name: 'Karlo Rafael Sunga Torres' }, vehicle: { plate_number: 'ABC-1234' },
    checks: [{ status: 'verified' }], readiness: 'VERIFIED', feasibility: { verdict: 'SAFE', reasons: [] },
    scheduleEvidence: { releaseAt: '2026-10-02T07:09:00.000Z', releaseLocal: 'Oct 2, 2026, 3:09 PM (Philippine time)', dutyWindow } }],
    recommended: { vehicle_id: 1, driver_id: 2 } } });
  const window = { dayOfWeek: 5, shiftStart: '06:00:00', shiftEnd: '22:00:00', breakStart: '12:00:00', breakEnd: '13:00:00' };
  const answer = evidenceSummary(mk(window), 'Is the 6 AM to 10 PM shift enforced?');
  expect(answer).toContain('6:00 AM');
  expect(answer).toContain('10:00 PM');
  expect(answer).toContain('12:00 PM');
  const hypo = evidenceSummary(mk(window), 'Would a 12:30 PM pickup be blocked?');
  expect(hypo).toContain('12:30 PM');
  expect(hypo).toContain('break');
  expect(hypo).toContain('shift and break rule only');
  const inside = evidenceSummary(mk(window), 'Would a 3 PM pickup be blocked?');
  expect(inside).toContain('fits the shift and break rule');
  const unprojected = evidenceSummary(mk(null), 'Is the shift enforced?');
  expect(unprojected).toContain("I can't verify that yet");
});
it('answers What needs fixing with blockers and next steps',()=>{
  const blocked={vehicle_id:2,driver_id:5,driver:{driver_name:'Blocked Driver'},vehicle:{plate_number:'XYZ 5678'},
    checks:[{id:'maintenance',label:'Service-window maintenance',status:'blocking',message:'Scheduled service overlaps.'}],
    readiness:'BLOCKED',feasibility:{verdict:'INFEASIBLE',reasons:['Scheduled service overlaps.']}};
  const evidence=conversationEvidence({request_id:3},{pair:{candidates:[blocked]}});
  const answer=evidenceSummary(evidence,'What needs fixing?');
  expect(answer).toContain('Blocked Driver with XYZ 5678');
  expect(answer).toContain('Check maintenance record');
  const ok={vehicle_id:1,driver_id:2,driver:{driver_name:'Karlo Rafael Sunga Torres'},vehicle:{plate_number:'ABC-1234'},
    checks:[{status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE',reasons:[]}};
  const clear=conversationEvidence({request_id:1},{pair:{candidates:[ok],recommended:ok}});
  expect(evidenceSummary(clear,'What needs fixing?')).toContain('Nothing in the current evidence needs fixing');
});
it('answers Other options with eligible pair plus recorded exclusions (RS-UZYD)',()=>{
  const ok={vehicle_id:1,driver_id:2,driver:{driver_name:'Karlo Rafael Sunga Torres'},vehicle:{plate_number:'ABC-1234'},
    checks:[{status:'verified'}],readiness:'VERIFIED',feasibility:{verdict:'SAFE',reasons:[]}};
  const evidence=conversationEvidence({request_id:1},{pair:{candidates:[ok],recommended:ok,
    none_reasons:[
      {vehicle_id:2,plate:'XYZ 5678',reason:'Vehicle XYZ 5678 insurance 2026-08-24 is not valid for this trip.'},
      {vehicle_id:3,plate:'DEF-9999',reason:'License details have not been verified by authorized staff.',driver_id:19,driver_name:'Other Driver'}]}});
  const answer=evidenceSummary(evidence,'Other options?');
  expect(answer).toContain('Karlo Rafael Sunga Torres with ABC-1234');
  expect(answer).toContain('XYZ 5678');
  expect(answer).toContain('not valid for this trip');
  const solo=conversationEvidence({request_id:2},{pair:{candidates:[ok],recommended:ok}});
  expect(evidenceSummary(solo,'Other options?')).toContain('only evaluated option');
});
