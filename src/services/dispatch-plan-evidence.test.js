import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({query: vi.fn()}));
vi.mock('@/lib/api/utils', () => ({AuthError: class extends Error { constructor(message,status,code) {super(message);this.status=status;this.code=code;} }}));
import { query } from '@/lib/db';
import { issuePlanToken, verifyPlanToken, readPlanRevision } from './dispatch-plan-evidence.service';

beforeEach(() => { vi.stubEnv('NEXTAUTH_SECRET','test-only-plan-secret'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T01:00:00Z')); query.mockReset(); query.mockResolvedValue({rows:[{revision:'r1'}]}); });
afterEach(() => {vi.useRealTimers();vi.unstubAllEnvs();});
const selection = {requestId:1,vehicleId:2,driverId:3};
it('binds manual authority to mode and never signs incomplete or dependent review',async()=>{
 const signed=issuePlanToken({revision:'r1',expiresAt:'2026-09-14T01:01:00Z',proposals:[
   {requestId:1,outcome:'REVIEW_REQUIRED',confirmationMode:'manual',pair:{vehicle_id:2,driver_id:3}},
   {requestId:4,outcome:'REVIEW_REQUIRED',confirmationMode:'manual',pair:{vehicle_id:2,driver_id:3},dependsOnRequestIds:[1]},
   {requestId:5,outcome:'VERIFIED',candidateEvaluationComplete:false,pair:{vehicle_id:2,driver_id:3}},
 ]});
 await expect(verifyPlanToken(signed,{...selection,mode:'manual'})).resolves.toMatchObject({version:2});
 await expect(verifyPlanToken(signed,{...selection,mode:'verified'})).rejects.toThrow('stale');
 for(const requestId of [4,5]) await expect(verifyPlanToken(signed,{...selection,requestId,mode:'manual'})).rejects.toThrow('stale');
});
const token = () => issuePlanToken({revision:'r1',expiresAt:'2026-09-14T01:01:00Z',proposals:[
  {requestId:1,outcome:'VERIFIED',pair:{vehicle_id:2,driver_id:3}},
  {requestId:4,outcome:'VERIFIED',pair:{vehicle_id:2,driver_id:3},dependsOnRequestIds:[1]},
  {requestId:5,outcome:'REVIEW_REQUIRED',pair:{vehicle_id:6,driver_id:7}},
]});
it('accepts only the signed independent verified choice; rejects tampering, dependent choices and changed fleet state', async () => {
  const signed=token();
  await expect(verifyPlanToken(signed,selection)).resolves.toMatchObject({revision:'r1'});
  await expect(verifyPlanToken(signed,{...selection,vehicleId:99})).rejects.toMatchObject({code:'STALE_DISPATCH_PLAN'});
  await expect(verifyPlanToken(signed,{...selection,requestId:4})).rejects.toThrow('stale');
  await expect(verifyPlanToken(signed+'x',selection)).rejects.toThrow('stale');
  query.mockResolvedValue({rows:[{revision:'changed-dispatch'}]});
  await expect(verifyPlanToken(signed,selection)).rejects.toThrow('stale');
});
it('fails closed on expiry and malformed tokens without querying or writing', async () => {
  const signed=token(); vi.advanceTimersByTime(60_000);
  await expect(verifyPlanToken(signed,selection)).rejects.toThrow('stale');
  await expect(verifyPlanToken(null,selection)).rejects.toThrow('stale');
  expect(query).not.toHaveBeenCalled();
});
it('uses a SELECT-only fingerprint covering requirements, fixed schedules and operational eligibility', async () => {
  await readPlanRevision();
  const sql=query.mock.calls[0][0];
  for (const table of ['transportation_requests','dispatchschedules','driver_vehicle_assignments','substitute_vehicle_schedules','driverattendance','driver_leave_requests','vehiclemaintenance','driverincidents','routes','locations']) expect(sql).toContain(table);
  expect(sql).toContain('to_jsonb(r)');
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
});
