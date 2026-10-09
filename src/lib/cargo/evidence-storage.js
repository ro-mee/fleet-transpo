import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { validateImage } from '@/lib/uploads/validator';
import { CARGO_EVIDENCE_BUCKET } from '@/lib/storage/key-format';
import { assertCargoStorageConfiguration, assertCargoDriver, loadExecutionForUpdate } from '@/services/cargo-execution.repository';
import { cargoError } from '@/services/cargo-manifest.service';

const fail = (code, message, status = 400) => { throw cargoError(code, message, status); };
const uuid = z.string().uuid();
const inputSchema = z.object({ file: z.custom(value => value && typeof value.arrayBuffer === 'function'), tripId: z.number().int().positive(), submissionId: uuid }).strict();
export function validateCargoImage(file, bytes) {
  // The shared validator checks the supplied size: replace it with bytes we actually received.
  const result = validateImage({ type: file?.type, size: bytes.byteLength }, bytes);
  if (result.error) fail('CARGO_INVALID_IMAGE', result.error);
  return { ...result, byteLength: bytes.byteLength, contentHash: createHash('sha256').update(bytes).digest('hex') };
}
export function assertCargoEvidenceKey(row) {
  if (![row.execution_id, row.submission_id, row.evidence_id].every(value => uuid.safeParse(value).success) || row.bucket !== CARGO_EVIDENCE_BUCKET || !['image/jpeg', 'image/png'].includes(row.mime_type)) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo evidence was not found.', 404);
  const expected = `${row.execution_id}/${row.submission_id}/${row.evidence_id}.${row.mime_type === 'image/jpeg' ? 'jpg' : 'png'}`;
  if (row.object_key !== expected) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo evidence was not found.', 404);
  return expected;
}

// There is no approved runtime provider. This exact public interface fails shut
// without opening the database, reading bytes, or instantiating a storage client.
export async function storeCargoEvidence() {
  fail('CARGO_CONFIGURATION_REQUIRED', 'Private cargo evidence is not configured.', 503);
}

// Explicit simulated dependency seam only. Future runtime wiring needs review.
export function createCargoEvidenceStore({ db, storage, config }) {
  assertCargoStorageConfiguration(config);
  if (config.simulated !== true || !['test', 'development'].includes(config.environment) || process.env.NODE_ENV === 'production') fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo evidence fixtures are nonproduction only.', 503);
  const transaction = work => db.withTransaction(tx => work({ ...tx, cargoConfig: config }));

  async function storeCargoEvidence(input, actor) {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) fail('CARGO_INVALID_IMAGE', 'A file and assigned trip are required.');
    const { file, tripId, submissionId } = parsed.data;
    // Authenticate ownership before reading bytes or minting/storing anything.
    await transaction(tx => assertCargoDriver(tripId, actor, tx));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = validateCargoImage(file, bytes);
    const row = await transaction(async tx => {
      const execution = await loadExecutionForUpdate(tripId, { ...tx, cargoActor: actor });
      const existing = (await tx.query(`SELECT * FROM cargo_evidence WHERE execution_id=$1 AND uploader_employee_id=$2 AND submission_id=$3 AND content_hash=$4 FOR UPDATE`, [execution.execution_id, actor.user.employeeId, submissionId, validated.contentHash])).rows[0];
      if (existing) {
        if (existing.uploader_driver_id !== actor.user.driverId || existing.mime_type !== validated.contentType || existing.byte_length !== validated.byteLength) fail('CARGO_REPLAY_CONFLICT', 'Evidence replay differs.', 409);
        assertCargoEvidenceKey(existing); return existing;
      }
      if ((await tx.query('SELECT receipt_id FROM cargo_receipts WHERE execution_id=$1 AND submission_id=$2', [execution.execution_id, submissionId])).rows.length) fail('CARGO_REPLAY_CONFLICT', 'Receipt is already immutable.', 409);
      const evidenceId = randomUUID();
      const objectKey = `${execution.execution_id}/${submissionId}/${evidenceId}.${validated.extension}`;
      return (await tx.query(`INSERT INTO cargo_evidence(evidence_id,execution_id,uploader_employee_id,uploader_driver_id,submission_id,object_key,mime_type,byte_length,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [evidenceId, execution.execution_id, actor.user.employeeId, actor.user.driverId, submissionId, objectKey, validated.contentType, validated.byteLength, validated.contentHash])).rows[0];
    });
    if (['READY', 'ATTACHED'].includes(row.state)) return { evidence_id: row.evidence_id };
    const key = assertCargoEvidenceKey(row);
    try {
      // Retrying the same staged object writes exactly the same validated bytes.
      // A storage adapter must honor upsert so an upload-success/DB-failure retry converges.
      await storage.upload(key, bytes, { bucket: CARGO_EVIDENCE_BUCKET, contentType: validated.contentType, upsert: true });
      await transaction(async tx => {
        await assertCargoDriver(tripId, actor, tx);
        const result = await tx.query("UPDATE cargo_evidence SET state='READY',updated_at=now() WHERE evidence_id=$1 AND state IN ('STAGED','ORPHANED') RETURNING evidence_id", [row.evidence_id]);
        if (!result.rows.length) {
          const current = (await tx.query('SELECT state FROM cargo_evidence WHERE evidence_id=$1', [row.evidence_id])).rows[0];
          if (!['READY', 'ATTACHED'].includes(current?.state)) fail('CARGO_UPLOAD_UNAVAILABLE', 'Evidence could not be recorded.', 503);
        }
      });
    } catch {
      // The committed STAGED record remains recoverable even if this status write fails.
      try { await transaction(tx => tx.query("UPDATE cargo_evidence SET state='ORPHANED',updated_at=now() WHERE evidence_id=$1 AND state='STAGED'", [row.evidence_id])); } catch { /* committed staged row tracks the unresolved boundary */ }
      fail('CARGO_UPLOAD_UNAVAILABLE', 'Cargo photo could not be recorded. Retry this upload.', 503);
    }
    return { evidence_id: row.evidence_id };
  }

  async function signCargoEvidence(evidenceId, actor) {
    if (!uuid.safeParse(evidenceId).success) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo evidence was not found.', 404);
    // Hold trip ownership through signing. No caller object key or generic signer.
    return transaction(async tx => {
      const row = (await tx.query(`SELECT e.*,x.trip_id FROM cargo_evidence e JOIN cargo_trip_executions x USING(execution_id)
        WHERE e.evidence_id=$1 AND e.state IN ('READY','ATTACHED')`, [evidenceId])).rows[0];
      if (!row) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo evidence was not found.', 404);
      await assertCargoDriver(row.trip_id, actor, tx);
      if (row.uploader_employee_id !== actor.user.employeeId || row.uploader_driver_id !== actor.user.driverId) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo evidence was not found.', 404);
      const key = assertCargoEvidenceKey(row);
      return storage.sign(key, { bucket: CARGO_EVIDENCE_BUCKET, expiresIn: 300 });
    });
  }
  return { storeCargoEvidence, signCargoEvidence };
}
