import { afterEach, it, expect, vi } from 'vitest';
import { authorizeRequestSource, authorizeCargoSource } from './source-auth';
const req = value => new Request('http://localhost', { headers: value == null ? {} : { authorization: value } });
afterEach(() => vi.unstubAllEnvs());
it('binds PMS/POS machines to distinct secrets and does not trust query tokens', async () => {
  vi.stubEnv('BOOKING_WEBHOOK_SECRET', 'pms'); vi.stubEnv('POS_WEBHOOK_SECRET', 'pos');
  expect(await authorizeRequestSource(req('Bearer pos'))).toMatchObject({ source: 'POS', actor: 'service' });
  expect(await authorizeRequestSource(new Request('http://localhost?token=pms'))).toBeNull();
});
it('never falls back to staff with equal secrets or invalid Authorization', async () => {
  const staff = vi.fn(async () => ({ actor: 'user' }));
  vi.stubEnv('BOOKING_WEBHOOK_SECRET', 'same'); vi.stubEnv('POS_WEBHOOK_SECRET', 'same');
  expect(await authorizeRequestSource(req(), { staffFallback: staff })).toBeNull();
  vi.stubEnv('POS_WEBHOOK_SECRET', 'pos');
  expect(await authorizeRequestSource(req('Bearer wrong'), { staffFallback: staff })).toBeNull();
  expect(staff).not.toHaveBeenCalled();
  expect(await authorizeRequestSource(req(), { staffFallback: staff })).toEqual({ actor: 'user' });
});
it('requires approved exact organization credentials, never staff or empty credentials', async () => {
  vi.stubEnv('BOOKING_WEBHOOK_SECRET', 'pms');
  expect(await authorizeCargoSource(req('Bearer pms'), {})).toBeNull();
  const credential = { system: 'PMS', organization_id: 'simulated:hotel', subject: 'fixture', capabilities: ['cargo:manifest:write'], secret: 'fixture-only', approval_ref: 'simulated:test', simulated: true };
  const options = { allowSandbox: true, environment: 'test', credentials: [credential] };
  expect(await authorizeCargoSource(req('Bearer fixture-only'), options)).toEqual({ system: 'PMS', organization_id: 'simulated:hotel', subject: 'fixture', capabilities: ['cargo:manifest:write'] });
  for (const patch of [{ environment: 'production' }, { allowSandbox: false }, { credentials: [{ ...credential, approval_ref: '' }] }, { credentials: [{ ...credential, secret: '' }] }, { credentials: [credential, { ...credential, organization_id: 'other' }] }]) {
    expect(await authorizeCargoSource(req('Bearer fixture-only'), { ...options, ...patch })).toBeNull();
  }
});
