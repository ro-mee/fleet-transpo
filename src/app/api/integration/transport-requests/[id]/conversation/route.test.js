import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('@/lib/api/utils',()=>({requirePermission:vi.fn(),parseBody:req=>req.json(),AuthError:class extends Error{constructor(message,status){super(message);this.status=status;}},handleError:e=>Response.json({error:e.message},{status:e.status??500})}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:vi.fn(async()=>({allowed:true}))}));
vi.mock('@/services/reservation-lifecycle.service',()=>({loadRequest:vi.fn(async()=>({request_id:1,passenger_count:4}))}));
vi.mock('@/services/dispatch-recommendation-preparation.service',()=>({prepareDispatchRecommendation:vi.fn(async()=>({request:{request_id:1},recommendation:{evaluatedAt:'2026-09-15',pair:{candidates:[],none_reasons:[{reason:'No designated driver'}]}}}))}));
vi.mock('@/services/dispatch-radar.service',()=>({applyDispatchRadar:vi.fn(async()=>{})}));
vi.mock('@/services/dispatch-plan-evidence.service',()=>({verifyPlanToken:vi.fn()}));
vi.mock('@/lib/ai/llm-adapter',()=>({executeLlmCompletion:vi.fn(async()=>({success:false}))}));
import {requirePermission} from '@/lib/api/utils';
import {prepareDispatchRecommendation} from '@/services/dispatch-recommendation-preparation.service';
import {executeLlmCompletion} from '@/lib/ai/llm-adapter';
import {verifyPlanToken} from '@/services/dispatch-plan-evidence.service';
import {POST} from './route';
const call=body=>POST(new Request('http://localhost/conversation',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'1'})});
beforeEach(()=>{vi.clearAllMocks();requirePermission.mockResolvedValue({user:{employeeId:1}});});
it.each([
 {selectedPair:{vehicleId:0,driverId:1}},
 {selectedPair:{vehicleId:1,driverId:-1}},
 {selectedPair:{vehicleId:'1',driverId:1}},
 {selectedPair:{vehicleId:1,driverId:1.5}},
 {selectedPair:{vehicleId:Number.MAX_SAFE_INTEGER+1,driverId:1}},
 {selectedPair:[]},
 {selectedPair:{vehicleId:1}},
 {displayedEvaluatedAt:'not-a-time'},
 {displayedEvaluatedAt:42},
 {displayedOptions:[{vehicleId:'1',driverId:2}]},
 {displayedOptions:[{vehicleId:1,driverId:2},{vehicleId:3,driverId:4},{vehicleId:5,driverId:6}]},
])('rejects malformed selection context before evidence/provider work: %j',async context=>{
 expect((await call({message:'Why this pair?',...context})).status).toBe(400);
 expect(prepareDispatchRecommendation).not.toHaveBeenCalled();
 expect(executeLlmCompletion).not.toHaveBeenCalled();
});
it('resolves displayed card numbers against fresh evidence without treating them as a selection',async()=>{
 prepareDispatchRecommendation.mockResolvedValueOnce({recommendation:{pair:{candidates:[{vehicle_id:3,driver_id:4},{vehicle_id:1,driver_id:2}],recommended:{vehicle_id:3,driver_id:4}}}});
 await call({message:'Why Option 1?',displayedOptions:[{vehicleId:1,driverId:2,instructions:'fabricated availability'},{vehicleId:5,driverId:6}]});
 const prompt=JSON.parse(executeLlmCompletion.mock.calls[0][0].user_prompt);
 expect(prompt.serverEvidence.selection).toBeNull();
 expect(prompt.serverEvidence.displayedOptions).toEqual([{option:1,vehicleId:1,driverId:2,status:'resolved'},{option:2,vehicleId:5,driverId:6,status:'missing'}]);
 expect(JSON.stringify(prompt)).not.toContain('fabricated availability');
});
it('grounds a selected alternative in fresh evidence even when the queue token is stale',async()=>{
 const recommended={vehicle_id:1,driver_id:2};
 const selected={vehicle_id:3,driver_id:4,vehicle:{plate_number:'SELECTED'},checks:[],feasibility:{verdict:'UNKNOWN'}};
 prepareDispatchRecommendation.mockResolvedValueOnce({recommendation:{evaluatedAt:'2026-09-15T02:00:00Z',pair:{candidates:[recommended,selected],recommended}}});
 verifyPlanToken.mockRejectedValueOnce(new Error('Expired'));
 executeLlmCompletion.mockResolvedValueOnce({success:true,content:'Selected pair needs verification.'});
 const response=await call({message:'Why this pair?',selectedPair:{vehicleId:3,driverId:4,checks:'invented'},displayedEvaluatedAt:'2026-09-15T01:00:00Z',planToken:'private-token'});
 const data=await response.json();
 expect(data.selection).toEqual({vehicleId:3,driverId:4,status:'resolved'});
 expect(data.evaluatedAt).toBe('2026-09-15T02:00:00Z');
 const options=executeLlmCompletion.mock.calls[0][0];
 const prompt=JSON.parse(options.user_prompt);
 expect(prompt.serverEvidence.pairs[0].vehicleId).toBe(3);
 expect(prompt.serverEvidence.pairs[0].state).toBe('INSUFFICIENT_DATA');
 expect(prompt.queue.status).toContain('stale');
 expect(options.system_instructions).toContain('use serverEvidence.selection');
 expect(options.user_prompt).not.toMatch(/private-token|invented/);
 expect(data).not.toHaveProperty('actions');
});
it('uses the selected-pair fallback when the provider is unavailable',async()=>{
 prepareDispatchRecommendation.mockResolvedValueOnce({recommendation:{pair:{candidates:[{vehicle_id:1,driver_id:2}],recommended:{vehicle_id:1,driver_id:2}}}});
 const data=await (await call({message:'Why this pair?',selectedPair:{vehicleId:3,driverId:4}})).json();
 expect(data.mode).toBe('evidence-only');
 expect(data.selection.status).toBe('missing');
 expect(data.answer).toContain('selected vehicle #3 / driver #4');
});
it('rejects unauthorized or oversized questions before evidence/provider work',async()=>{
 requirePermission.mockRejectedValueOnce(Object.assign(new Error('Forbidden'),{status:403}));
 expect((await call({message:'Why?'})).status).toBe(403);
 expect((await call({message:'a'.repeat(1001)})).status).toBe(400);
 expect(prepareDispatchRecommendation).not.toHaveBeenCalled();
 expect(executeLlmCompletion).not.toHaveBeenCalled();
});
it('answers without a pair, provides honest provider fallback and never returns mutation commands',async()=>{
 const response=await call({message:'Bakit walang driver? Assign mo na.',history:[]});
 const data=await response.json();
 expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 expect(data).toMatchObject({mode:'evidence-only'});
 expect(data.answer).toContain('No designated driver');
 expect(data).not.toHaveProperty('actions');
 expect(executeLlmCompletion.mock.calls[0][0].system_instructions).toContain('no mutation tools');
 expect(executeLlmCompletion.mock.calls[0][0].system_instructions).toContain('Always answer in plain English');
});
