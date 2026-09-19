import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('@/lib/api/utils',()=>({requirePermission:vi.fn(),parseBody:req=>req.json(),AuthError:class extends Error{constructor(message,status){super(message);this.status=status;}},handleError:e=>Response.json({error:e.message},{status:e.status??500})}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:vi.fn(async()=>({allowed:true}))}));
vi.mock('@/services/reservation-lifecycle.service',()=>({loadRequest:vi.fn(async()=>({request_id:1,passenger_count:4}))}));
vi.mock('@/services/dispatch-recommendation-preparation.service',()=>({prepareDispatchRecommendation:vi.fn(async()=>({request:{request_id:1},recommendation:{evaluatedAt:'2026-09-15',pair:{candidates:[],none_reasons:[{reason:'No designated driver'}]}}}))}));
vi.mock('@/services/dispatch-radar.service',()=>({applyDispatchRadar:vi.fn(async()=>{})}));
vi.mock('@/services/dispatch-plan-evidence.service',()=>({verifyPlanToken:vi.fn()}));
vi.mock('@/lib/ai/llm-adapter',()=>({executeLlmCompletion:vi.fn(async()=>({success:false}))}));
import {requirePermission} from '@/lib/api/utils';
import {loadRequest} from '@/services/reservation-lifecycle.service';
import {prepareDispatchRecommendation} from '@/services/dispatch-recommendation-preparation.service';
import {executeLlmCompletion} from '@/lib/ai/llm-adapter';
import {verifyPlanToken} from '@/services/dispatch-plan-evidence.service';
import {POST} from './route';
process.env.NEXTAUTH_SECRET ??= 'test-secret-for-conversation';
const call=body=>POST(new Request('http://localhost/conversation',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'1'})});
beforeEach(()=>{vi.clearAllMocks();requirePermission.mockResolvedValue({user:{employeeId:1}});});
it.each([
  ['Hi','Hi. How can I help with this reservation or fleet operation?'],
  ['Thanks','Hi. How can I help with this reservation or fleet operation?'],
  ['Recommend a movie.',"I'm focused on FleetOps and transportation operations. I can help with reservations, dispatch, drivers, vehicles, trips, ETA, incidents, or related fleet decisions."],
])('handles %s without reservation/provider work',async(message,answer)=>{
  const response=await call({message,selectedPair:{vehicleId:7,driverId:8},displayedOptions:[{vehicleId:7,driverId:8}],planToken:'ignored'});
  const data=await response.json();
  expect(response.status).toBe(200);
  expect(data).toMatchObject({answer,mode:'scope-only',choiceOptions:[],evaluatedAt:null,selection:null,coverage:null,snapshot:null,intent:null});
  expect(JSON.stringify(data)).not.toMatch(/serverEvidence|vehicleId|driverId|ignored/);
  expect(loadRequest).not.toHaveBeenCalled();
  expect(prepareDispatchRecommendation).not.toHaveBeenCalled();
  expect(executeLlmCompletion).not.toHaveBeenCalled();
});
it('keeps a FleetOps follow-up in the normal evidence path',async()=>{
  await call({message:'Why?',history:[{role:'user',content:'Why is Driver 12 unavailable?'}]});
  expect(loadRequest).toHaveBeenCalled();
  expect(prepareDispatchRecommendation).toHaveBeenCalled();
  expect(executeLlmCompletion).toHaveBeenCalled();
});
it('does not revive context after an out-of-scope turn',async()=>{
  const response=await call({message:'Why?',history:[{role:'user',content:'Recommend a movie.'}],selectedPair:{vehicleId:7,driverId:8}});
  const data=await response.json();
  expect(data.mode).toBe('scope-only');
  expect(data.answer).toContain("I'm focused on FleetOps");
  expect(loadRequest).not.toHaveBeenCalled();
  expect(executeLlmCompletion).not.toHaveBeenCalled();
});
it('scope-only replies do not add a choice prompt or mutate the supplied UI context',async()=>{
  const response=await call({message:'Thanks',selectedPair:{vehicleId:7,driverId:8},displayedOptions:[{vehicleId:7,driverId:8},{vehicleId:9,driverId:10}],planToken:'plan'});
  const data=await response.json();
  expect(data.choiceOptions).toEqual([]);
  expect(data.selection).toBeNull();
  expect(data.snapshot).toBeNull();
  expect(JSON.stringify(data)).not.toMatch(/plan|7|8|9|10/);
});
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
it('asks a concise clarification for dateless what-if instead of guessing',async()=>{
  const data=await (await call({message:'What if pickup is 7 PM for 4 passengers?'})).json();
  expect(data.mode).toBe('evidence-only');
  expect(data.answer).toMatch(/which date/i);
  expect(data.answer).toMatch(/4 passenger/);
  expect(data.answer).not.toMatch(/19:00.*Sep|Sep.*19:00/);
  const prompt=JSON.parse(executeLlmCompletion.mock.calls.at(-1)[0].user_prompt);
  expect(prompt.intent).toMatchObject({type:'simulate',status:'needs-date'});
});
it('passes a low temperature for faithful narration',async()=>{
  await call({message:'Why no match?'});
  expect(executeLlmCompletion.mock.calls.at(-1)[0].temperature).toBe(0.2);
});
it('mints a comparison proof only for two resolved displayed options',async()=>{
  prepareDispatchRecommendation.mockResolvedValueOnce({recommendation:{pair:{candidates:[{vehicle_id:1,driver_id:2},{vehicle_id:3,driver_id:4}],recommended:{vehicle_id:1,driver_id:2}}}});
  const two=await (await call({message:'Compare?',displayedOptions:[{vehicleId:1,driverId:2},{vehicleId:3,driverId:4}]})).json();
  expect(two.comparisonProof?.type).toBe('comparison');
  expect(typeof two.comparisonProof?.ref).toBe('string');
  const one=await (await call({message:'Compare?',displayedOptions:[{vehicleId:1,driverId:2}]})).json();
  expect(one.comparisonProof).toBeNull();
});
it('composes every prompt block exactly once with hierarchy and lifecycle wording',async()=>{
  await call({message:'Why no match?'});
  const instructions=executeLlmCompletion.mock.calls.at(-1)[0].system_instructions;
  for (const marker of ['1. Hard eligibility','ELIGIBLE','RECOMMENDED','SELECTED','ASSIGNED','LIVE GPS HEALTH',
    'a simulation never authorizes assignment','rechecking does not fix them','No signal means there is no usable GPS timestamp','say plainly there is no material change','displayedOptions']) {
    const occurrences=instructions.split(marker).length-1;
    expect(occurrences).toBe(1);
  }
});
