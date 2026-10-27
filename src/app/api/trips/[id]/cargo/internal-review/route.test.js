import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api/utils', () => ({ requirePermission: vi.fn(async () => ({user:{role:'fleet_manager',employeeId:2}})), parseBody: req=>req.json(),ok:data=>Response.json(data),err:(error,status=400)=>Response.json({error},{status}),handleError:e=>Response.json({error:e.message},{status:e.status||500}) }));
vi.mock('@/services/cargo-execution.service', () => ({ reviewInternalCargo: vi.fn(async()=>({version:3})) }));
import { POST } from './route';
import { requirePermission } from '@/lib/api/utils';
import { reviewInternalCargo } from '@/services/cargo-execution.service';
const payload={submission_id:'11111111-1111-4111-8111-111111111111',receipt_id:'22222222-2222-4222-8222-222222222222',expected_version:2,kind:'SOURCE',action:'ACCEPT_OBSERVED',reason:'Reviewed count and pickup evidence.',reviewed_evidence_ids:[]};
const run=(value=payload,id='7')=>POST(new Request('http://localhost/api/trips/7/cargo/internal-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),{params:Promise.resolve({id})});
describe('authenticated internal manager review',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('uses current authenticated identity and exact immutable review input',async()=>{
    const response=await run();expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(expect.any(Request),'cargo','review_internal');
    expect(reviewInternalCargo).toHaveBeenCalledWith(7,payload,expect.objectContaining({user:{role:'fleet_manager',employeeId:2}}));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('returns only a decision acknowledgment, not private signatures or proof documents',async()=>{
    reviewInternalCargo.mockResolvedValueOnce({version:3,trip_id:7,pickup_receipt:{payload:{handover:{signer_name:'Private',signature:'drawing'}}},fleet_clearance:{safety_proof:{private:true}}});
    const response=await run(),data=await response.json();expect(data.version).toBe(3);
    expect(data).not.toHaveProperty('pickup_receipt');expect(data).not.toHaveProperty('fleet_clearance');
  });
  it('does not accept a supplied approving identity',async()=>{
    expect((await run({...payload,approved_by:99})).status).toBe(400);expect(reviewInternalCargo).not.toHaveBeenCalled();
  });
  it('refuses incomplete securement attestations and invalid trip IDs',async()=>{
    expect((await run({...payload,kind:'SECUREMENT',action:'CLEAR'})).status).toBe(400);
    expect((await run(payload,'-1')).status).toBe(400);expect(reviewInternalCargo).not.toHaveBeenCalled();
    expect((await run(payload,'2147483648')).status).toBe(400);expect(reviewInternalCargo).not.toHaveBeenCalled();
  });
  it('does not perform a review after role denial',async()=>{
    requirePermission.mockRejectedValueOnce(Object.assign(new Error('Forbidden'),{status:403}));
    expect((await run()).status).toBe(403);expect(reviewInternalCargo).not.toHaveBeenCalled();
  });
  it('preserves actionable stale-record refusal from the review service',async()=>{
    reviewInternalCargo.mockRejectedValueOnce(Object.assign(new Error('Refresh the latest receipt.'),{status:409,code:'CARGO_RECEIPT_STALE'}));
    const response=await run();expect(response.status).toBe(409);expect((await response.json()).code).toBe('CARGO_RECEIPT_STALE');
  });
});
