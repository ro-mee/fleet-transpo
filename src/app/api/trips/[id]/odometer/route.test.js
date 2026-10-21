import { beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ guard: vi.fn(), service: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({
  requirePermission: deps.guard,
  AuthError: class extends Error { constructor(message,status,code) { super(message); this.status=status; this.code=code; } },
  ok: (value,status=200) => Response.json(value,{status}),
  handleError: error => Response.json({error:error.message,code:error.code},{status:error.status || 500}),
}));
vi.mock('@/services/trip-odometer.service', () => ({ readTripOdometerEvidence: deps.service }));
import { GET } from './route';
const context = { params: Promise.resolve({id:'7',captureId:'12345678-1234-4234-8234-123456789abc'}) };
beforeEach(() => { vi.clearAllMocks(); deps.guard.mockResolvedValue({user:{driverId:4}}); deps.service.mockResolvedValue({state:'ready'}); });
const request = () => {
  return new Request('http://local');
};
it('authorizes before accessing capture data', async () => {
  deps.guard.mockRejectedValue(Object.assign(new Error('Unauthorized'),{status:401}));
  expect((await GET(request(),context)).status).toBe(401);
  expect(deps.service).not.toHaveBeenCalled();
});
it('awaits params and returns private noncached evidence', async () => {
  const response=await GET(request(),context);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(deps.service).toHaveBeenCalledWith(expect.objectContaining({tripId:'7'}));
  expect(deps.guard).toHaveBeenCalledWith(expect.anything(),'trips','read_all');
});
