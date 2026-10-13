import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'admin', query: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: state.query }));
vi.mock('@/lib/api/utils', () => ({
  AuthError: class extends Error { constructor(message, status, code) { super(message); Object.assign(this, { status, code }); } },
  requirePermission: async (_req, resource, action) => {
    const { rolesFor } = await import('@/lib/auth/permissions');
    if (!rolesFor(resource, action).includes(state.role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
    return { user: { role: state.role } };
  },
  handleError: error => Response.json({ error: error.message, code: error.code }, { status: error.status ?? 500 }),
}));
import { GET, PUT } from './route';
beforeEach(() => { vi.clearAllMocks(); state.role = 'admin'; });
it.each(['admin', 'super_admin', 'fleet_manager', 'dispatcher', 'management'])('refuses retired roster reads for authorized %s without querying storage', async role => {
  state.role = role;
  const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: '1' }) });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'QUALIFICATION_ROSTER_RETIRED' });
  expect(state.query).not.toHaveBeenCalled();
});
it.each(['driver', 'mechanic'])('preserves read denial for %s', async role => {
  state.role = role;
  expect((await GET(new Request('http://localhost'))).status).toBe(403);
});
it.each(['admin', 'super_admin'])('refuses %s writes before reading the body', async role => {
  state.role = role;
  const req = { json: vi.fn(() => { throw new Error('must not read'); }) };
  expect((await PUT(req)).status).toBe(503);
  expect(req.json).not.toHaveBeenCalled();
  expect(state.query).not.toHaveBeenCalled();
});
it.each(['fleet_manager', 'dispatcher', 'driver', 'management', 'mechanic'])('preserves manage denial for %s', async role => {
  state.role = role;
  expect((await PUT(new Request('http://localhost'))).status).toBe(403);
});
