import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const deps = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn(), storage: { upload: vi.fn(), download: vi.fn(), createSignedUrl: vi.fn() }, scan: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: deps.query, withTransaction: deps.withTransaction }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ storage: { from: () => deps.storage } }) }));
vi.mock('@/lib/trips/gemini-odometer', () => ({ scanOdometerWithGemini: deps.scan }));
vi.mock('@/lib/api/utils', () => ({ AuthError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } } }));
import { consumeOdometerCapture, uploadOdometerCapture, readOdometerCapture, scanOdometerCapture, readTripOdometerEvidence } from './trip-odometer.service';

const captureId = '12345678-1234-4234-8234-123456789abc';
const session = { user: { driverId: 4 } };
const trip = { trip_id: 7, driver_id: 4, vehicle_id: 2, trip_status: 'Driver Accepted', mileage: 100, start_odometer: 100 };
const row = (extra = {}) => ({ capture_id: captureId, trip_id: 7, driver_id: 4, vehicle_id: 2, stage: 'start', content_type: 'image/jpeg', storage_key: `trip-odometer-photos/4/7/start/${captureId}.jpg`, state: 'ready', reading_km: '123', unit: 'km', display_kind: 'total', uploaded_at: new Date(), scan_attempts: 0, ...extra });
let tx;
beforeEach(() => {
  vi.clearAllMocks();
  tx = { query: vi.fn() };
  deps.withTransaction.mockImplementation(fn => fn(tx));
  deps.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://private/preview' } });
});
describe('transaction consumption', () => {
  it.each([{ trip_id: 8 }, { driver_id: 5 }, { vehicle_id: 3 }, { stage: 'end' }])('refuses mismatched owned evidence %j', async extra => {
    tx.query.mockResolvedValueOnce({ rows: [row(extra)] });
    await expect(consumeOdometerCapture({ tx, trip, session, stage: 'start', captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
    expect(tx.query).toHaveBeenCalledTimes(1);
  });
  it('replays only the exact committed record despite age and later mileage', async () => {
    tx.query.mockResolvedValueOnce({ rows: [row({ state: 'committed', committed_at: new Date(), uploaded_at: new Date(0) })] });
    await expect(consumeOdometerCapture({ tx, trip: { ...trip, mileage: 900 }, session, stage: 'start', captureId })).resolves.toEqual({ readingKm: 123, captureId });
  });
  it('expires a ready capture without committing', async () => {
    tx.query.mockResolvedValueOnce({ rows: [row({ uploaded_at: new Date(Date.now() - 1800001) })] }).mockResolvedValueOnce({ rows: [] });
    await expect(consumeOdometerCapture({ tx, trip, session, stage: 'start', captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_EXPIRED' });
  });
  it('refuses another committed capture for the stage', async () => {
    tx.query.mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({ rows: [row({ capture_id: 'other' })] });
    await expect(consumeOdometerCapture({ tx, trip, session, stage: 'start', captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
  });
  it('reports a changed capture conflict even when the changed draft has expired', async () => {
    tx.query.mockResolvedValueOnce({ rows: [row({ uploaded_at: new Date(0) })] }).mockResolvedValueOnce({ rows: [{ capture_id: 'other' }] });
    await expect(consumeOdometerCapture({ tx, trip, session, stage: 'start', captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
  });
  it.each(['uploaded','unreadable'])('reports a changed %s capture after stage commitment as conflict', async state => {
    tx.query.mockResolvedValueOnce({ rows: [row({ state, reading_km: null })] }).mockResolvedValueOnce({ rows: [{ capture_id: 'other' }] });
    await expect(consumeOdometerCapture({ tx, trip, session, stage: 'start', captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH', status: 409 });
  });
  it('requires an explicit consume stage', async () => {
    tx.query.mockResolvedValueOnce({ rows: [row({ state: 'committed', committed_at: new Date() })] });
    await expect(consumeOdometerCapture({ tx, trip, session, captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
  });
  it('commits a verified reading inside the caller transaction', async () => {
    tx.query.mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [row({ state: 'committed' })], rowCount: 1 });
    await expect(consumeOdometerCapture({ tx, trip, session, stage: 'start', captureId })).resolves.toEqual({ readingKm: 123, captureId });
    expect(tx.query.mock.calls[2][0]).toContain("state='committed'");
  });
});
describe('upload boundaries', () => {
  it.each([null, 'https://attacker/image.jpg', { size: 5242881, type: 'image/jpeg', arrayBuffer: vi.fn() }])('rejects invalid file before storage', async file => {
    await expect(uploadOdometerCapture({ session, tripId: 7, stage: 'start', captureId, file })).rejects.toMatchObject({ status: 422 });
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });
  it('checks real byte length and signature, not the claimed size', async () => {
    for (const bytes of [new Uint8Array(5242881), new Uint8Array([1, 2, 3])]) {
      await expect(uploadOdometerCapture({ session, tripId: 7, stage: 'start', captureId, file: { size: 3, type: 'image/jpeg', arrayBuffer: async () => bytes.buffer } })).rejects.toMatchObject({ status: 422 });
    }
  });
});
describe('owned reads and scan', () => {
  it('does not sign another assigned driver capture', async () => {
    deps.query.mockResolvedValueOnce({ rows: [{ ...trip, driver_id: 9 }] });
    await expect(readOdometerCapture({ session, tripId: 7, captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
    expect(deps.storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it('does not call Gemini for an active scan lease', async () => {
    tx.query.mockResolvedValueOnce({ rows: [trip] }).mockResolvedValueOnce({ rows: [row({ state: 'scanning', scan_started_at: new Date() })] });
    await expect(scanOdometerCapture({ session, tripId: 7, captureId })).resolves.toMatchObject({ state: 'scanning' });
    expect(deps.scan).not.toHaveBeenCalled();
  });
  it('does not replay an expired ready draft as a fresh scan', async () => {
    tx.query.mockResolvedValueOnce({ rows: [trip] }).mockResolvedValueOnce({ rows: [row({ uploaded_at: new Date(0) })] });
    await expect(scanOdometerCapture({ session, tripId: 7, captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_EXPIRED' });
  });
  it('returns persisted distance provenance using the real trips column', async () => {
    deps.query.mockResolvedValueOnce({ rows: [{ ...trip, distance: 25, distance_provenance: 'odometer' }] }).mockResolvedValueOnce({ rows: [] });
    await expect(readTripOdometerEvidence({ tripId: 7 })).resolves.toMatchObject({ distance_km: 25, distance_source: 'odometer' });
  });
  it('returns saved legacy readings and only signs committed requested-trip evidence', async () => {
    deps.query.mockResolvedValueOnce({ rows: [{ ...trip, start_odometer: '100', end_odometer: null, distance: null, distance_source: null }] }).mockResolvedValueOnce({ rows: [] });
    await expect(readTripOdometerEvidence({ tripId: 7 })).resolves.toEqual({ start: { reading_km: 100, recorded_at: null, photo_url: null, photo_state: 'not_recorded' }, end: null, distance_km: null, distance_source: null });
    expect(deps.storage.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe('upload reservation and scan finalization', () => {
  const bytes = new Uint8Array([255, 216, 255, 1]);
  const file = { size: bytes.length, type: 'image/jpeg', arrayBuffer: async () => bytes.buffer };
  const stored = (extra = {}) => row({ state: 'uploaded', reading_km: null, byte_size: bytes.length, image_sha256: createHash('sha256').update(bytes).digest('hex'), ...extra });
  function reserve(existing = null, count = 0) {
    tx.query.mockImplementation(async sql => {
      if (sql.includes('pg_advisory')) return { rows: [] };
      if (sql.includes('FROM trips')) return { rows: [trip] };
      if (sql.includes('COUNT(*)')) return { rows: [{ count }] };
      if (sql.includes('INSERT INTO')) return { rows: [stored()] };
      if (sql.includes('FROM trip_odometer')) return { rows: existing ? [existing] : [] };
      throw new Error('Unexpected SQL');
    });
    deps.query.mockResolvedValue({ rows: [trip] });
    deps.storage.download.mockResolvedValue({ data: new Blob([bytes]) });
  }
  it('reconciles a lost upload response against the exact hash and returns a safe DTO', async () => {
    reserve(); deps.storage.upload.mockRejectedValue(new Error('timeout secret'));
    const result = await uploadOdometerCapture({ session, tripId: 7, stage: 'start', captureId, file });
    expect(result).toMatchObject({ capture_id: captureId, state: 'uploaded', preview_url: 'https://private/preview' });
    expect(result).not.toHaveProperty('storage_key');
    expect(deps.storage.upload).toHaveBeenCalledWith(`4/7/start/${captureId}.jpg`, bytes, { contentType: 'image/jpeg', upsert: false });
  });
  it('canonicalizes UUID casing before storing the deterministic object key', async () => {
    reserve(); deps.storage.upload.mockResolvedValue({ data: {} });
    await uploadOdometerCapture({ session, tripId: 7, stage: 'start', captureId: captureId.toUpperCase(), file });
    const values = tx.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO'))[1];
    expect(values[0]).toBe(captureId);
    expect(values[5]).toBe(`trip-odometer-photos/4/7/start/${captureId}.jpg`);
  });
  it('never confirms an upload timeout with different stored bytes', async () => {
    reserve(); deps.storage.upload.mockRejectedValue(new Error('timeout secret'));
    deps.storage.download.mockResolvedValue({ data: new Blob([new Uint8Array([255,216,255,2])]) });
    await expect(uploadOdometerCapture({ session, tripId: 7, stage: 'start', captureId, file })).rejects.toMatchObject({ code: 'ODOMETER_SCAN_UNAVAILABLE' });
  });
  it('refuses changed bytes for the same capture identity', async () => {
    reserve(stored({ image_sha256: 'a'.repeat(64) }));
    await expect(uploadOdometerCapture({ session, tripId: 7, stage: 'start', captureId, file })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });
  it('allows an exact identity retry without spending the hourly limit', async () => {
    reserve(stored(), 10); deps.storage.upload.mockResolvedValue({ error: { message: 'already exists' } });
    await expect(uploadOdometerCapture({ session, tripId: 7, stage: 'start', captureId, file })).resolves.toMatchObject({ capture_id: captureId });
  });
  it('bounds new images to ten per driver trip stage', async () => {
    reserve(null, 10);
    await expect(uploadOdometerCapture({ session, tripId: 7, stage: 'start', captureId, file })).rejects.toMatchObject({ code: 'ODOMETER_RATE_LIMITED', status: 429 });
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });
  function scanning({ result, current = null, reassigned = false } = {}) {
    const claimed = stored({ state: 'scanning', scan_attempts: 1, scan_started_at: new Date() });
    let tripReads = 0;
    tx.query.mockImplementation(async (sql, args) => {
      if (sql.includes('FROM trips')) return { rows: [{ ...trip, driver_id: reassigned && tripReads++ ? 9 : 4 }] };
      if (sql.includes('SET state=\'scanning\'')) return { rows: [claimed] };
      if (sql.includes('SET state=$4')) return { rows: current ? [] : [stored({ state: args[3], reading_km: args[5], failure_code: args[8] })] };
      if (sql.includes('FROM trip_odometer')) return { rows: [current || stored()] };
      throw new Error('Unexpected SQL');
    });
    deps.storage.download.mockResolvedValue({ data: new Blob([bytes]) });
    deps.scan.mockResolvedValue(result || { readingKm: 123, readingText: '123', unit: 'km', displayKind: 'total', failureCode: null, modelName: 'gemini-test', scanVersion: 'odometer-v1' });
  }
  it('uses owned bytes and compare-and-set claim fields when saving the scan', async () => {
    scanning();
    await expect(scanOdometerCapture({ session, tripId: 7, captureId })).resolves.toMatchObject({ state: 'ready', reading_km: 123 });
    expect(deps.scan).toHaveBeenCalledWith(bytes, 'image/jpeg', { signal: expect.any(AbortSignal) });
    const final = tx.query.mock.calls.find(([sql]) => sql.includes('SET state=$4'));
    expect(final[0]).toContain("state='scanning' AND scan_started_at=$2 AND scan_attempts=$3");
  });
  it('does not turn unsupported extraction into ready evidence', async () => {
    scanning({ result: { readingKm: null, readingText: '123', unit: 'mi', displayKind: 'total', failureCode: 'ODOMETER_UNIT_UNSUPPORTED' } });
    await expect(scanOdometerCapture({ session, tripId: 7, captureId })).resolves.toMatchObject({ state: 'unreadable', reading_km: null, failure_code: 'ODOMETER_UNIT_UNSUPPORTED' });
  });
  it('rechecks current driver ownership after the external scan', async () => {
    scanning({ reassigned: true });
    await expect(scanOdometerCapture({ session, tripId: 7, captureId })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
    expect(tx.query.mock.calls.some(([sql]) => sql.includes('SET state=$4'))).toBe(false);
  });
  it('times out a late download before it can start Gemini', async () => {
    vi.useFakeTimers();
    try {
      scanning();
      let release;
      const delayed = new Promise(resolve => { release = resolve; });
      deps.storage.download.mockReturnValueOnce(delayed);
      const result = scanOdometerCapture({ session, tripId: 7, captureId }).catch(error => error);
      await vi.advanceTimersByTimeAsync(31000);
      release({ data: new Blob([bytes]) });
      await vi.runAllTimersAsync();
      expect(await result).toMatchObject({ code: 'ODOMETER_SCAN_UNAVAILABLE' });
      expect(deps.scan).not.toHaveBeenCalled();
      const finalized = tx.query.mock.calls.find(([sql]) => sql.includes('SET state=$4'));
      expect(finalized[1][3]).toBe('failed');
    } finally { vi.useRealTimers(); }
  });
  it('propagates caller cancellation and safely releases only its claimed scan', async () => {
    scanning();
    const controller = new AbortController();
    let release;
    deps.storage.download.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const result = scanOdometerCapture({ session, tripId: 7, captureId, signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(deps.storage.download).toHaveBeenCalled());
    controller.abort();
    expect(await result).toMatchObject({ code: 'ODOMETER_SCAN_UNAVAILABLE' });
    release({ data: new Blob([bytes]) });
    expect(deps.scan).not.toHaveBeenCalled();
    expect(deps.storage.download.mock.calls[0][2]?.signal.aborted).toBe(true);
    const finalized = tx.query.mock.calls.find(([sql]) => sql.includes('SET state=$4'));
    expect(finalized[0]).toContain("state='scanning' AND scan_started_at=$2 AND scan_attempts=$3");
    expect(finalized[1][3]).toBe('failed');
  });
});
