import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/api/utils', () => ({
  requirePermission: vi.fn(), parseBody: vi.fn(req => req.json()),
  AuthError: class extends Error { constructor(message,status,code) {super(message);this.status=status;this.code=code;} },
  handleError: e => Response.json({error:e.message,code:e.code},{status:e.status ?? 500}),
}));
vi.mock('@/services/dispatch-plan.service', () => ({buildDispatchPlan:vi.fn()}));
vi.mock('@/services/dispatch-plan-evidence.service', () => ({readPlanRevision:vi.fn(),issuePlanToken:vi.fn(),verifyPlanToken:vi.fn()}));
import { requirePermission } from '@/lib/api/utils';
import { buildDispatchPlan } from '@/services/dispatch-plan.service';
import { readPlanRevision, issuePlanToken, verifyPlanToken } from '@/services/dispatch-plan-evidence.service';
import { POST, PATCH } from './route';
it('rejects unbound or coverage-losing selections and only signs a fully rechecked alternative',async()=>{
 const selection={requestId:1,vehicleId:2,driverId:3};
 const call=body=>POST(new Request('http://localhost/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 expect((await call({date:'2026-09-16',selection:{...selection,driverId:'3'}})).status).toBe(400);
 verifyPlanToken.mockResolvedValue({version:2,window:{date:'2026-09-16'},coverage:[1,4],choices:[[1,9,9,'verified']]});
 const proposal={requestId:1,outcome:'VERIFIED',pair:{vehicle_id:2,driver_id:3}};
 buildDispatchPlan.mockResolvedValue({expiresAt:new Date(Date.now()+60_000).toISOString(),analysisComplete:true,proposals:[proposal]});
 expect((await call({date:'2026-09-16',selection,basePlanToken:'signed'})).status).toBe(409);
 expect(issuePlanToken).not.toHaveBeenCalled();
 buildDispatchPlan.mockResolvedValue({expiresAt:new Date(Date.now()+60_000).toISOString(),analysisComplete:true,proposals:[proposal,{requestId:4,outcome:'VERIFIED',pair:{vehicle_id:5,driver_id:6}}]});
 expect((await call({date:'2026-09-16',selection,basePlanToken:'signed'})).status).toBe(200);
 expect(issuePlanToken).toHaveBeenCalled();
});

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({user:{employeeId:1}});
  readPlanRevision.mockResolvedValue('same');
  issuePlanToken.mockReturnValue('signed');
  buildDispatchPlan.mockResolvedValue({expiresAt:new Date(Date.now()+60_000).toISOString(),proposals:[],totalRequests:0});
});
it('requires both read and recommend before evaluating; read-only callers cannot analyze', async () => {
  requirePermission.mockImplementation(async (_req,_resource,action) => { if(action==='recommend') throw Object.assign(new Error('Forbidden'),{status:403}); });
  const response=await POST(new Request('http://localhost/api/plan',{method:'POST'}));
  expect(response.status).toBe(403);
  expect(buildDispatchPlan).not.toHaveBeenCalled();
  expect(issuePlanToken).not.toHaveBeenCalled();
});
it('rejects fleet mutation during analysis instead of signing a mixed-state plan', async () => {
  readPlanRevision.mockResolvedValueOnce('before').mockResolvedValueOnce('after');
  const response=await POST(new Request('http://localhost/api/plan',{method:'POST'}));
  expect(response.status).toBe(409);
  expect(issuePlanToken).not.toHaveBeenCalled();
});
it('returns a private signed advisory and validates it without regenerating', async () => {
  const response=await POST(new Request('http://localhost/api/plan',{method:'POST'}));
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({planToken:'signed',totalRequests:0});
  buildDispatchPlan.mockClear();
  verifyPlanToken.mockResolvedValue({expiresAt:'2026-09-14T00:00:00Z'});
  const valid=await PATCH(new Request('http://localhost/api/plan',{method:'PATCH',body:JSON.stringify({planToken:'signed'})}));
  expect(valid.status).toBe(200);
  expect(verifyPlanToken).toHaveBeenCalledWith('signed');
  expect(buildDispatchPlan).not.toHaveBeenCalled();
});
it('passes the selected date to the existing planner and rejects impossible dates',async()=>{
 const call=date=>POST(new Request('http://localhost/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date})}));
 expect((await call('2026-09-16')).status).toBe(200);
 expect(buildDispatchPlan).toHaveBeenCalledWith({date:'2026-09-16',selection:null});
 buildDispatchPlan.mockClear();
 expect((await call('2026-02-30')).status).toBe(400);
 expect(buildDispatchPlan).not.toHaveBeenCalled();
});
