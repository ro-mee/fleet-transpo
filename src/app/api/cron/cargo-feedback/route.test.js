import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/cargo-feedback.service',()=>({deliverCargoFeedback:vi.fn(async()=>({acknowledged:0,pending:0,failed:0}))}));
import { POST } from './route';
import { deliverCargoFeedback } from '@/services/cargo-feedback.service';
beforeEach(()=>{vi.clearAllMocks();process.env.CRON_SECRET='fixture-cron-secret';});
describe('cargo feedback worker route',()=>{
  it('requires service authentication and enforces a bounded batch',async()=>{
    const unauthorized=await POST(new Request('http://localhost/api/cron/cargo-feedback',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
    expect(unauthorized.status).toBe(401); expect(deliverCargoFeedback).not.toHaveBeenCalled();
    const authorized=await POST(new Request('http://localhost/api/cron/cargo-feedback',{method:'POST',headers:{authorization:'Bearer fixture-cron-secret','content-type':'application/json'},body:JSON.stringify({batch_size:25})}));
    expect(authorized.status).toBe(200); expect(deliverCargoFeedback).toHaveBeenCalledWith({batchSize:25});
  });
  it('rejects unbounded batches and arbitrary gateway fields',async()=>{
    const tooLarge=await POST(new Request('http://localhost/api/cron/cargo-feedback',{method:'POST',headers:{authorization:'Bearer fixture-cron-secret','content-type':'application/json'},body:JSON.stringify({batch_size:101})}));
    const url=await POST(new Request('http://localhost/api/cron/cargo-feedback',{method:'POST',headers:{authorization:'Bearer fixture-cron-secret','content-type':'application/json'},body:JSON.stringify({batch_size:5,url:'https://evil.test'})}));
    expect(tooLarge.status).toBe(400); expect(url.status).toBe(400); expect(deliverCargoFeedback).not.toHaveBeenCalled();
  });
});
