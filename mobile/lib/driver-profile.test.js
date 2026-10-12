import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { expect, it, vi } from 'vitest';

const { code } = await transform(readFileSync(new URL('./driver-profile.js', import.meta.url), 'utf8'), { format: 'cjs' });
function harness() {
  let generation = 1;
  let actorId = 'employee-1';
  const slots = [];
  let cursor = 0;
  const effects = [];
  let scheduled;
  const get = vi.fn().mockResolvedValue({ driverType: 'Cargo', privateField: 'kept' });
  const cached = vi.fn().mockResolvedValue({ data: { driverType: 'Passenger' }, syncedAt: Date.now() });
  const writes = vi.fn();
  const scope = { exports: {} };
  const dependencies = {
    react: {
      useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = value; }]; },
      useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: fn => { effects.push(fn); },
    },
    './api': { api: { get } }, './auth': { useAuth: () => ({ user: { employeeId: actorId, driverId: 'driver-9' } }) },
    './offline-cache': { resolveDriverId: user => user.employeeId, getCached: cached, setCached: writes, CACHE_KEYS: { DRIVER_ME: 'me' } },
    './cargo-sync': {
      captureCargoSession: id => id === actorId ? { actorId, generation } : null,
      isCurrentCargoSession: session => !!session && session.actorId === actorId && session.generation === generation,
    },
  };
  runInNewContext(code, { exports: scope.exports, module: scope, require: name => dependencies[name], setTimeout: fn => { scheduled = fn; return 1; }, clearTimeout, Date, Map });
  const render = () => { cursor = 0; const result = scope.exports.useDriverProfile(); while (effects.length) effects.shift()(); return result; };
  return { render, get, cached, writes, startLoad: () => scheduled(), relogin: () => { generation++; }, switchAccount: () => { actorId = 'employee-2'; generation++; } };
}
it('keeps cached type display-only until server confirms the full profile', async () => {
  const h = harness(); h.get.mockRejectedValueOnce(new Error('offline'));
  await h.render().reload();
  expect(h.render().profile.driverType).toBe('Passenger');
  expect(h.render().serverConfirmed).toBe(false);
  await h.render().reload();
  expect(h.render().serverConfirmed).toBe(true);
  expect(h.render().profile.privateField).toBe('kept');
  expect(h.cached).toHaveBeenCalledWith('employee-1', 'me');
});
it('same-account login must refresh even with fresh module memory', async () => {
  const h = harness(); await h.render().reload(); h.relogin();
  expect(h.render().serverConfirmed).toBe(false);
  h.get.mockResolvedValueOnce({ driverType: 'Passenger' });
  h.render(); h.startLoad();
  await vi.waitFor(() => expect(h.render().profile.driverType).toBe("Passenger"));
  expect(h.render().serverConfirmed).toBe(true);
});
it('discards a profile response after the account changes', async () => {
  const h = harness(); let resolve;
  h.get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = h.render().reload();
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function")); h.switchAccount();
  resolve({ driverType: 'Cargo' }); await pending;
  expect(h.render().serverConfirmed).toBe(false);
  expect(h.writes).not.toHaveBeenCalled();
});
