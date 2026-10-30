import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ requirePermission: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({
  requirePermission: state.requirePermission, parseBody: req => req.json(),
  ok: (data, status = 200) => Response.json(data, { status }),
  handleError: error => Response.json({ error: error.message, code: error.code }, { status: error.status || 500 }),
}));
vi.mock('@/services/internal-reservation.service', () => ({ createInternalCargoReservation: state.create }));
import { POST } from './route';
const session = { user: { role: 'dispatcher', employeeId: 12 } };
beforeEach(() => { vi.clearAllMocks(); state.requirePermission.mockResolvedValue(session); state.create.mockResolvedValue({ request_id: 601, idempotent: false }); });
const request = () => new Request('http://localhost/api/reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ submission_id: 'test' }) });

it('requires staff reservation-create permission and passes the resolved actor to atomic intake', async () => {
  const req = request();
  const res = await POST(req);
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ request_id: 601 });
  expect(state.requirePermission).toHaveBeenCalledWith(req, 'reservations', 'create');
  expect(state.create).toHaveBeenCalledWith({ submission_id: 'test' }, session, { req });
  expect(res.headers.get('cache-control')).toContain('no-store');
});
it('returns successful exact replay without claiming another creation', async () => {
  state.create.mockResolvedValue({ request_id: 601, idempotent: true });
  expect((await POST(request())).status).toBe(200);
});
it('does not write when a machine bearer or unauthorized session fails staff authentication', async () => {
  state.requirePermission.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  expect(state.create).not.toHaveBeenCalled();
});
it('preserves changed-retry conflicts and private no-store responses', async () => {
  state.create.mockRejectedValue(Object.assign(new Error('Changed retry'), { status: 409, code: 'INTERNAL_RESERVATION_REPLAY_CONFLICT' }));
  const res = await POST(request());
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('INTERNAL_RESERVATION_REPLAY_CONFLICT');
  expect(res.headers.get('cache-control')).toContain('no-store');
});
