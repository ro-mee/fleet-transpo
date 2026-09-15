import {it,expect} from 'vitest';
import {conversationEvidence,evidenceSummary,plainChatText} from './conversation';
import {dispatchPlanWindow} from './plan-window';
it('resolves the selected pair before truncation and keeps the engine recommendation separate',()=>{
 const candidates=Array.from({length:18},(_,i)=>({vehicle_id:i+1,driver_id:100+i,vehicle:{plate_number:`PLATE-${i+1}`},checks:[],feasibility:{verdict:'UNKNOWN'}}));
 const evidence=conversationEvidence({request_id:1},{pair:{candidates,recommended:candidates[0],none_reasons:Array.from({length:35},(_,i)=>({vehicle_id:50+i,reason:'Under maintenance',prefiltered:true}))}},{vehicleId:18,driverId:117,privateField:'secret'});
 expect(evidence.selection).toEqual({vehicleId:18,driverId:117,status:'resolved'});
 expect(evidence.pairs.slice(0,2).map(p=>p.vehicleId)).toEqual([18,1]);
 expect(evidence.recommended.vehicleId).toBe(1);
 expect(evidence.coverage).toEqual({pairs:{total:18,included:12,truncated:true},exclusions:{total:35,included:30,truncated:true}});
 expect(evidenceSummary(evidence)).toContain('PLATE-18 / driver #117');
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
it('carries prefiltered exclusions with plate and flag for the Copilot',()=>{
 const evidence=conversationEvidence({request_id:502}, {pair:{candidates:[],none_reasons:[{vehicle_id:1,plate:'XYZ 5678',reason:'Vehicle status is Under Maintenance.',prefiltered:true}]}});
 expect(evidence.exclusions).toEqual([{vehicleId:1,plate:'XYZ 5678',reason:'Vehicle status is Under Maintenance.',prefiltered:true}]);
 expect(evidenceSummary(evidence)).toContain('Under Maintenance');
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
