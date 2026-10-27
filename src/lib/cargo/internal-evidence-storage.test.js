import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/services/cargo-internal-authority', () => ({ assertInternalCargoTrip: vi.fn() }));
vi.mock('@/services/cargo-execution.repository', () => ({ assertCargoStorageConfiguration: vi.fn(), assertCargoDriver: vi.fn(), loadExecutionForUpdate: vi.fn() }));
vi.mock('@/lib/db', () => ({ withTransaction: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
import { assertInternalCargoTrip } from '@/services/cargo-internal-authority';
import { loadExecutionForUpdate } from '@/services/cargo-execution.repository';
import { createInternalCargoEvidenceStore } from './evidence-storage';
import { createInternalCargoStorageAdapter } from './internal-evidence-storage';

const id = '11111111-1111-4111-8111-111111111111';
const row = { execution_id: id, submission_id: id, evidence_id: id, trip_id: 7, mime_type: 'image/jpeg', bucket: 'cargo-evidence', object_key: `${id}/${id}/${id}.jpg`, uploader_employee_id: 1, uploader_driver_id: 1 };
const manager = { user: { role: 'fleet_manager', employeeId: 2 } };
beforeEach(() => vi.resetAllMocks());

it('checks internal trip authority before reading upload bytes', async () => {
  assertInternalCargoTrip.mockRejectedValue(Object.assign(new Error('Foreign trip'), { status: 404 }));
  const file = { arrayBuffer: vi.fn() };
  const store = createInternalCargoEvidenceStore({ db: { withTransaction: work => work({ query: vi.fn() }) }, storage: {} });
  await expect(store.storeCargoEvidence({ file, tripId: 7, submissionId: id }, { user: { role: 'driver', employeeId: 1, driverId: 1 } })).rejects.toMatchObject({ status: 404 });
  expect(file.arrayBuffer).not.toHaveBeenCalled();
  expect(loadExecutionForUpdate).not.toHaveBeenCalled();
});

it('requires persisted internal manager authority and the exact trip before signing', async () => {
  const storage = { sign: vi.fn(async () => ({ url: 'private', expires_in: 300 })) };
  const store = createInternalCargoEvidenceStore({ db: { withTransaction: work => work({ query: async () => ({ rows: [row] }) }) }, storage });
  await expect(store.signCargoEvidence(id, manager, { tripId: 8 })).rejects.toMatchObject({ status: 404 });
  expect(storage.sign).not.toHaveBeenCalled();
  await expect(store.signCargoEvidence(id, manager, { tripId: 7 })).resolves.toMatchObject({ expires_in: 300 });
  expect(assertInternalCargoTrip).toHaveBeenCalledWith(7, manager, expect.anything(), { managerOnly: true });
  assertInternalCargoTrip.mockRejectedValue(Object.assign(new Error('External source disabled'), { status: 503 }));
  await expect(store.signCargoEvidence(id, manager, { tripId: 7 })).rejects.toMatchObject({ status: 503 });
  expect(storage.sign).toHaveBeenCalledTimes(1);
});

it('keeps uploads recoverable and reuses the same receipt-bound object after a failed upload', async () => {
  let saved;
  loadExecutionForUpdate.mockResolvedValue({ execution_id: id });
  const query = async (sql, values) => {
    if (sql.startsWith('SELECT * FROM cargo_evidence')) return { rows: saved ? [saved] : [] };
    if (sql.startsWith('SELECT receipt_id')) return { rows: [] };
    if (sql.startsWith('INSERT INTO cargo_evidence')) {
      saved = { evidence_id: values[0], execution_id: values[1], uploader_employee_id: values[2], uploader_driver_id: values[3], submission_id: values[4], object_key: values[5], mime_type: values[6], byte_length: values[7], content_hash: values[8], retention_state: values[9], bucket: 'cargo-evidence', state: 'STAGED' };
      return { rows: [saved] };
    }
    if (sql.includes("SET state='ORPHANED'")) saved.state = 'ORPHANED';
    if (sql.includes("SET state='READY'")) saved.state = 'READY';
    return { rows: [{ evidence_id: saved?.evidence_id }] };
  };
  const storage = { upload: vi.fn().mockRejectedValueOnce(new Error('Upload failed')).mockResolvedValue(undefined) };
  const store = createInternalCargoEvidenceStore({ db: { withTransaction: work => work({ query }) }, storage });
  const bytes = new Uint8Array([255, 216, 255]);
  const input = { tripId: 7, submissionId: id, file: { type: 'image/jpeg', arrayBuffer: async () => bytes.buffer } };
  const driver = { user: { role: 'driver', employeeId: 1, driverId: 1 } };
  await expect(store.storeCargoEvidence(input, driver)).rejects.toMatchObject({ status: 503 });
  expect(saved).toMatchObject({ state: 'ORPHANED', submission_id: id, retention_state: 'INTERNAL_PRESERVE' });
  const original = { ...saved };
  await expect(store.storeCargoEvidence(input, driver)).resolves.toEqual({ evidence_id: original.evidence_id });
  expect(saved.state).toBe('READY');
  expect(storage.upload.mock.calls[0][0]).toBe(storage.upload.mock.calls[1][0]);
  expect(storage.upload.mock.calls[1][1]).toEqual(bytes);
});

it('does not sign another uploader photo for an assigned driver', async () => {
  const storage = { sign: vi.fn() };
  const store = createInternalCargoEvidenceStore({ db: { withTransaction: work => work({ query: async () => ({ rows: [row] }) }) }, storage });
  await expect(store.signCargoEvidence(id, { user: { role: 'driver', employeeId: 8, driverId: 9 } }, { tripId: 7 })).rejects.toMatchObject({ status: 404 });
  expect(storage.sign).not.toHaveBeenCalled();
});

it('uses only the private cargo bucket, server content type and five-minute signing', async () => {
  const bucket = { upload: vi.fn(async () => ({ error: null })), createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'private' } })) };
  const client = { storage: { from: vi.fn(() => bucket) } };
  const storage = createInternalCargoStorageAdapter(() => client);
  await storage.upload(row.object_key, new Uint8Array([255, 216, 255]), { bucket: 'cargo-evidence', contentType: 'image/jpeg', upsert: true });
  await expect(storage.sign(row.object_key, { bucket: 'cargo-evidence', expiresIn: 300 })).resolves.toEqual({ url: 'private', expires_in: 300 });
  expect(client.storage.from.mock.calls.every(([name]) => name === 'cargo-evidence')).toBe(true);
  await expect(storage.sign(row.object_key, { bucket: 'vehicle-images', expiresIn: 300 })).rejects.toThrow();
  await expect(storage.sign(row.object_key, { bucket: 'cargo-evidence', expiresIn: 3600 })).rejects.toThrow();
});
