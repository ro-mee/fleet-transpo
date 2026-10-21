import { beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ guard: vi.fn(), service: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({
  requireDriver: deps.guard,
  AuthError: class extends Error { constructor(message,status,code) { super(message); this.status=status; this.code=code; } },
  ok: (value,status=200) => Response.json(value,{status}),
  handleError: error => Response.json({error:error.message,code:error.code},{status:error.status || 500}),
}));
vi.mock('@/services/trip-odometer.service', () => ({ uploadOdometerCapture: deps.service }));
import { POST } from './route';
const context = { params: Promise.resolve({id:'7',captureId:'12345678-1234-4234-8234-123456789abc'}) };
beforeEach(() => { vi.clearAllMocks(); deps.guard.mockResolvedValue({user:{driverId:4}}); deps.service.mockResolvedValue({state:'ready'}); });
const request = () => {
  const body = new FormData(); body.set('image',new Blob([new Uint8Array([255,216,255])],{type:'image/jpeg'}),'photo.jpg'); body.set('stage','start'); body.set('capture_id','12345678-1234-4234-8234-123456789abc'); return new Request('http://local',{method:'POST',body});
};
it('authorizes before accessing capture data', async () => {
  deps.guard.mockRejectedValue(Object.assign(new Error('Unauthorized'),{status:401}));
  expect((await POST(request(),context)).status).toBe(401);
  expect(deps.service).not.toHaveBeenCalled();
});
it('awaits params and returns private noncached evidence', async () => {
  const response=await POST(request(),context);
  expect(response.status).toBe(201);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(deps.service).toHaveBeenCalledWith(expect.objectContaining({tripId:'7'}));
  
});
it('rejects client supplied URLs or readings', async () => {
  const body=new FormData(); body.set('url','https://attacker/image'); const req=new Request('http://local',{method:'POST',body});
  expect((await POST(req,context)).status).toBe(400);
  expect(deps.service).not.toHaveBeenCalled();
});
it('bounds the multipart bytes even without a Content-Length header', async () => {
  const req = new Request('http://local',{method:'POST',body:new Uint8Array(5242880+65537),headers:{'content-type':'multipart/form-data; boundary=test'}});
  expect((await POST(req,context)).status).toBe(422);
  expect(deps.service).not.toHaveBeenCalled();
});
