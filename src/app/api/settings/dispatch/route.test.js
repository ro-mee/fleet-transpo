import {it,expect,vi} from 'vitest';
vi.mock('@/lib/api/utils',()=>({requirePermission:vi.fn(async()=>({user:{employeeId:1}})),parseBody:async req=>req.body,ok:data=>({status:200,data}),err:(error,status)=>({error,status}),handleError:e=>{throw e;}}));
vi.mock('@/services/dispatch-settings.service',()=>({getDispatchPolicy:vi.fn(),saveDispatchPolicy:vi.fn(async p=>p)}));
vi.mock('@/lib/audit',()=>({writeAudit:vi.fn()}));
import {getDispatchPolicy,saveDispatchPolicy} from '@/services/dispatch-settings.service';
import {DEFAULT_DISPATCH_POLICY} from '@/lib/dispatch-policy';
import {PUT} from './route';
it('preserves saved temporal buffers and validates partial edits against saved thresholds',async()=>{
  getDispatchPolicy.mockResolvedValue({...DEFAULT_DISPATCH_POLICY,bufferFloorMinutes:25,shortNoticeHorizonMinutes:120});
  const result=await PUT({body:{enableVipFlag:false}});
  expect(result.data).toMatchObject({bufferFloorMinutes:25,shortNoticeHorizonMinutes:120,enableVipFlag:false});
  saveDispatchPolicy.mockClear();
  expect((await PUT({body:{highMinutes:1}})).status).toBe(400);
  expect(saveDispatchPolicy).not.toHaveBeenCalled();
});
