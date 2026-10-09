import { describe, it, expect, vi } from 'vitest';
import { storeCargoEvidence, createCargoEvidenceStore, validateCargoImage, assertCargoEvidenceKey } from './evidence-storage';
import { parseStoredKey, KNOWN_MEDIA_BUCKETS } from '@/lib/storage/key-format';
import { signedUrlFor } from '@/lib/storage/object-refs';

const id = '11111111-1111-4111-8111-111111111111';
const config = { dataApprovalRef: 'simulated:data', privacyApprovalRef: 'simulated:privacy', receivingApprovalRef: 'simulated:receiving', retentionApprovalRef: 'simulated:retention', sourceApprovalRef: 'simulated:source', schemaReady: true, simulated: true, environment: 'test' };
describe('private cargo evidence boundaries', () => {
  it('default runtime refuses before reading a file or opening storage', async () => {
    const file = { arrayBuffer: vi.fn() };
    await expect(storeCargoEvidence({ file, tripId: 1, submissionId: id }, {})).rejects.toMatchObject({ status: 503 });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });
  it('checks actual bytes and actual size even if metadata claims one byte', () => {
    expect(() => validateCargoImage({ type: 'image/jpeg', size: 1 }, new Uint8Array(5 * 1024 * 1024 + 1))).toThrow();
    expect(() => validateCargoImage({ type: 'image/png', size: 3 }, new Uint8Array([255, 216, 255]))).toThrow();
    expect(() => validateCargoImage({ type: 'image/svg+xml', size: 3 }, new Uint8Array([255, 216, 255]))).toThrow();
    expect(validateCargoImage({ type: 'image/jpeg', size: 999 }, new Uint8Array([255, 216, 255]))).toMatchObject({ byteLength: 3, extension: 'jpg' });
  });
  it('requires exact server key, bucket, execution, submission and evidence identity', () => {
    const row = { execution_id: id, submission_id: id, evidence_id: id, mime_type: 'image/jpeg', object_key: `${id}/${id}/${id}.jpg`, bucket: 'cargo-evidence' };
    expect(assertCargoEvidenceKey(row)).toBe(row.object_key);
    for (const changes of [{ bucket: 'incident-evidence' }, { object_key: `https://host/${row.object_key}` }, { object_key: `other/${id}/${id}.jpg` }, { object_key: `${id}/${id}/../${id}.jpg` }]) expect(() => assertCargoEvidenceKey({ ...row, ...changes })).toThrow();
  });
  it('does not allow simulated dependencies in production', () => {
    expect(() => createCargoEvidenceStore({ config: { ...config, environment: 'production' } })).toThrow();
  });
  it('rejects caller object keys before database access', async () => {
    const db = { withTransaction: vi.fn() };
    const store = createCargoEvidenceStore({ db, storage: {}, config });
    await expect(store.storeCargoEvidence({ file: { arrayBuffer: vi.fn() }, tripId: 1, submissionId: id, object_key: 'arbitrary.jpg' }, {})).rejects.toMatchObject({ status: 400 });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
  it('keeps cargo references out of unrelated generic media readers', async () => {
    expect(KNOWN_MEDIA_BUCKETS.has('cargo-evidence')).toBe(false);
    expect(parseStoredKey(`cargo-evidence/${id}/${id}/${id}.jpg`)).toBe(null);
    expect(await signedUrlFor('driver-licenses', `cargo-evidence/${id}/${id}/${id}.jpg`)).toBe(null);
  });
});
