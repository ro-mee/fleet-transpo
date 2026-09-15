import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({query:vi.fn()}));
vi.mock('@/lib/api/utils', () => ({requirePermission:vi.fn(),parseBody: req=>req.json(),ok: data=>Response.json(data),err:(error,status)=>Response.json({error},{status}),handleError:e=>Response.json({error:e.message},{status:e.status ?? 500})}));
vi.mock('@/services/reservation-lifecycle.service', () => ({loadRequest:vi.fn(),advanceReservation:vi.fn()}));
vi.mock('@/services/reservation-events.service', () => ({recordReservationEvent:vi.fn()}));
vi.mock('@/lib/scheduling/conflicts', () => ({detectRequestConflicts:vi.fn(async()=>[])}));
vi.mock('@/lib/scheduling/travel-buffer', () => ({tomtomEtaMinutes:vi.fn()}));
vi.mock('@/services/recommendation.service', () => ({validatePairAvailability:vi.fn(),getActiveRecommendation:vi.fn(),markRecommendationConsumed:vi.fn()}));
vi.mock('@/services/dispatch-autocreate.service', () => ({createDispatchForRequest:vi.fn(),syncDispatchSideEffects:vi.fn()}));
vi.mock('@/lib/audit', () => ({writeAudit:vi.fn()}));
vi.mock('@/services/dispatch-evidence.service', () => ({commitDispatchEvidence:vi.fn()}));
vi.mock('@/services/dispatch-plan-evidence.service', () => ({verifyPlanToken:vi.fn()}));
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/api/utils';
import { loadRequest,advanceReservation } from '@/services/reservation-lifecycle.service';
import { recordReservationEvent } from '@/services/reservation-events.service';
import { validatePairAvailability } from '@/services/recommendation.service';
import { createDispatchForRequest,syncDispatchSideEffects } from '@/services/dispatch-autocreate.service';
import { commitDispatchEvidence } from '@/services/dispatch-evidence.service';
import { verifyPlanToken } from '@/services/dispatch-plan-evidence.service';
import { PUT } from './route';
const request=()=>new Request('http://localhost/api/integration/transport-requests/1/assign',{method:'PUT',body:JSON.stringify({vehicle_id:2,driver_id:3,plan_token:'signed'})});
const params={params:Promise.resolve({id:'1'})};
beforeEach(()=>{
 vi.clearAllMocks();
 requirePermission.mockResolvedValue({user:{employeeId:1}});
 loadRequest.mockResolvedValue({request_id:1,fleet_status:'Pending'});
 verifyPlanToken.mockResolvedValue({revision:'same'});
 validatePairAvailability.mockResolvedValue({ok:true,commitToken:{revision:'same'}});
 query.mockImplementation(async sql=>({rows:sql.includes('FROM vehicles')?[{vehicle_id:2,plate_number:'ABC'}]:[{driver_id:3,first_name:'Driver'}]}));
});
it('requires assignment permission even when a caller possesses a valid proposal',async()=>{
 requirePermission.mockRejectedValueOnce(Object.assign(new Error('Forbidden'),{status:403}));
 expect((await PUT(request(),params)).status).toBe(403);
 expect(requirePermission).toHaveBeenCalledWith(expect.anything(),'reservations','assign');
 expect(verifyPlanToken).not.toHaveBeenCalled();expect(advanceReservation).not.toHaveBeenCalled();
});
it('rejects blank forced-review reasons before loading or mutating a request',async()=>{
 const req=new Request('http://localhost/assign',{method:'PUT',body:JSON.stringify({vehicle_id:2,driver_id:3,force:true,override_reason:'  '})});
 const response=await PUT(req,params);expect(response.status).toBe(400);
 expect(loadRequest).not.toHaveBeenCalled();expect(advanceReservation).not.toHaveBeenCalled();
});
it('rejects stale plans before lifecycle changes or notifications',async()=>{
 verifyPlanToken.mockRejectedValueOnce(Object.assign(new Error('Stale plan'),{status:409}));
 expect((await PUT(request(),params)).status).toBe(409);
 expect(advanceReservation).not.toHaveBeenCalled();expect(recordReservationEvent).not.toHaveBeenCalled();expect(syncDispatchSideEffects).not.toHaveBeenCalled();
});
it('rechecks the plan inside the locked commit before writing if state races after the initial check',async()=>{
 const tx={query:vi.fn()};
 commitDispatchEvidence.mockImplementation(async (_token,write)=>write(tx));
 advanceReservation.mockImplementation(async ({writeAssignment})=>writeAssignment('UPDATE transportation_requests',[]));
 verifyPlanToken.mockResolvedValueOnce({revision:'same'}).mockRejectedValueOnce(Object.assign(new Error('Stale plan'),{status:409}));
 expect((await PUT(request(),params)).status).toBe(409);
 expect(verifyPlanToken).toHaveBeenLastCalledWith('signed',{requestId:'1',vehicleId:2,driverId:3,mode:'verified'},tx);
 expect(tx.query).not.toHaveBeenCalled();expect(createDispatchForRequest).not.toHaveBeenCalled();expect(syncDispatchSideEffects).not.toHaveBeenCalled();
});
