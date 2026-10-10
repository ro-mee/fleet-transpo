import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api/utils', () => ({ requirePermission: vi.fn(), parseBody: vi.fn(req=>req.json()), ok: data=>Response.json(data), handleError: error=>Response.json({error:error.message,code:error.code},{status:error.status??500}), AuthError: class extends Error { constructor(message,status,code){super(message);Object.assign(this,{status,code});} } }));
vi.mock('@/services/cargo-feedback.service', () => ({ listCargoFeedback: vi.fn(async()=>[]), retryCargoFeedback: vi.fn(async()=>({event_id:'11111111-1111-4111-8111-111111111111',status:'PENDING'})) }));
import { GET, POST } from './route';
import { requirePermission } from '@/lib/api/utils';
import { listCargoFeedback, retryCargoFeedback } from '@/services/cargo-feedback.service';

beforeEach(()=>vi.clearAllMocks());
describe('cargo feedback staff route',()=>{
  it('requires integrations read for feedback lookup and passes trip plus source scope',async()=>{
    requirePermission.mockResolvedValueOnce({user:{employeeId:4}});
    const response=await GET(new Request('http://localhost/api/integration/cargo/feedback?trip_id=9&source_system=PMS&organization_id=hotel-a'));
    expect(response.status).toBe(200); expect(requirePermission).toHaveBeenCalledWith(expect.anything(),'integrations','read');
    expect(listCargoFeedback).toHaveBeenCalledWith({tripId:9,sourceSystem:'PMS',organizationId:'hotel-a',limit:50});
  });
  it('requires a distinct integrations execute permission before retrying the same event',async()=>{
    requirePermission.mockResolvedValueOnce({user:{employeeId:4}});
    const eventId='11111111-1111-4111-8111-111111111111';
    const response=await POST(new Request('http://localhost/api/integration/cargo/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trip_id:9,source_system:'PMS',organization_id:'hotel-a',event_id:eventId})}));
    expect(response.status).toBe(200); expect(requirePermission).toHaveBeenCalledWith(expect.anything(),'integrations','execute');
    expect(retryCargoFeedback).toHaveBeenCalledWith({tripId:9,sourceSystem:'PMS',organizationId:'hotel-a',eventId});
  });
  it('rejects body URLs and does not retry',async()=>{
    requirePermission.mockResolvedValueOnce({});
    const response=await POST(new Request('http://localhost/api/integration/cargo/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trip_id:9,source_system:'PMS',organization_id:'hotel-a',event_id:'11111111-1111-4111-8111-111111111111',url:'https://evil.test'})}));
    expect(response.status).toBe(400); expect(retryCargoFeedback).not.toHaveBeenCalled();
  });
});
