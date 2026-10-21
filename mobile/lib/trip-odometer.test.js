import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';

const path = new URL('./trip-odometer.js', import.meta.url);
async function load() {
  const apiFetch = vi.fn().mockResolvedValue({ capture_id: 'capture' });
  class Form { values = []; append(...args) { this.values.push(args); } }
  const code = (await transform(readFileSync(path, 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, FormData: Form, AbortController, Date, Math, require: name => name === './api' ? { apiFetch } : name === './cargo-sync' ? { isCurrentCargoSession: session => !session.signal.aborted } : {} });
  return { ...scope.exports, apiFetch };
}
describe('odometer API actor and retry boundary', () => {
  it('has a shared helper for both camera stages', () => expect(existsSync(path)).toBe(true));
  it('uploads only the camera image, stage and stable ID with abort and no queue', async () => {
    const { odometerApi, apiFetch } = await load();
    const session = { actorId: '10', signal: new AbortController().signal };
    await odometerApi.upload(7, { stage: 'start', captureId: 'capture', asset: { uri: 'file://photo.jpg' } }, session);
    const [url, options] = apiFetch.mock.calls[0];
    expect(url).toBe('/api/mobile/driver/trips/7/odometer');
    expect(options).toMatchObject({ method: 'POST', queueOnFailure: false, cargoActorId: '10', signal: session.signal });
    expect(options.body.values).toEqual([['stage', 'start'], ['capture_id', 'capture'], ['image', { uri: 'file://photo.jpg', name: 'odometer.jpg', type: 'image/jpeg' }]]);
    await odometerApi.scan(7, 'capture', session);
    await odometerApi.read(7, 'capture', session);
    for (const [, opts] of apiFetch.mock.calls) expect(opts).toMatchObject({ queueOnFailure: false, cargoActorId: '10', signal: session.signal });
  });
  it('routes only server-required starts and preserves inspection continuation', async () => {
    const { odometerStartRoute } = await load();
    expect(odometerStartRoute({ trip_id: 7 })).toBe(null);
    expect(odometerStartRoute({ trip_id: 7, odometer_photo_required_at_start: true })).toEqual({ pathname: '/inspection', params: { tripId: '7', continuation: 'odometer-start' } });
    expect(odometerStartRoute({ trip_id: 7, pre_trip_status: 'Passed', odometer_photo_required_at_start: true })).toEqual({ pathname: '/trip/odometer', params: { tripId: '7', stage: 'start' } });
  });
  it('creates distinct UUIDs for retakes and rejects expired/unreadable/wrong-stage evidence', async () => {
    const { newOdometerCaptureId, captureReady } = await load();
    const first = newOdometerCaptureId();
    expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(newOdometerCaptureId()).not.toBe(first);
    const record = { capture_id: first, trip_id: 7, stage: 'start', state: 'ready', unit: 'km', reading_km: 1000, uploaded_at: new Date().toISOString() };
    expect(captureReady(record, 7, 'start', first)).toBe(true);
    expect(captureReady({ ...record, uploaded_at: '2000-01-01' }, 7, 'start', first)).toBe(false);
    expect(captureReady({ ...record, state: 'unreadable' }, 7, 'start', first)).toBe(false);
    expect(captureReady(record, 7, 'end', first)).toBe(false);
  });
});
