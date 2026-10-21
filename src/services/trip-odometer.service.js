import { createHash } from 'node:crypto';
import { query, withTransaction } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateImage } from '@/lib/uploads/validator';
import { scanOdometerWithGemini } from '@/lib/trips/gemini-odometer';
import { isPreStartTripStatus } from '@/lib/scheduling/trip-state';

const BUCKET = 'trip-odometer-photos';
const MAX_BYTES = 5242880;
const MAX_AGE = 30 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(['Trip Started', 'At Pickup', 'Passenger Onboard', 'In Progress', 'En Route', 'Drop-off', 'Arrived']);
const fail = (code = 'ODOMETER_CAPTURE_MISMATCH', status = 409, message = 'This odometer photo does not match the current trip.') => { throw new AuthError(message, status, code); };
const unavailable = () => fail('ODOMETER_SCAN_UNAVAILABLE', 503, 'The odometer photo could not be read. Please retry.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const numeric = value => value == null ? null : Number(value);
const validReading = row => Number.isFinite(Number(row.reading_km)) && Number(row.reading_km) > 0 && Number(row.reading_km) <= 2000000 && row.unit === 'km' && row.display_kind === 'total';

function inputs(tripId, captureId, stage) {
  if (!Number.isSafeInteger(Number(tripId)) || Number(tripId) <= 0 || !UUID.test(captureId || '') || (stage !== undefined && !['start', 'end'].includes(stage))) fail();
}
function owner(trip, session) {
  if (!trip || trip.deleted_at || !session?.user?.driverId || Number(trip.driver_id) !== Number(session.user.driverId) || !trip.vehicle_id) fail();
}
function binding(row, trip, session, stage) {
  owner(trip, session);
  if (!row || Number(row.trip_id) !== Number(trip.trip_id) || Number(row.driver_id) !== Number(trip.driver_id) || Number(row.vehicle_id) !== Number(trip.vehicle_id) || (stage !== undefined && row.stage !== stage)) fail();
  objectKey(row);
}
function phase(trip, stage) {
  if (!(stage === 'start' ? isPreStartTripStatus(trip.trip_status) : ACTIVE.has(trip.trip_status))) fail();
}
function fresh(row) {
  const age = Date.now() - new Date(row.uploaded_at).getTime();
  if (!Number.isFinite(age) || age > MAX_AGE) fail('ODOMETER_CAPTURE_EXPIRED', 409, 'This photo has expired. Please take a new photo.');
}
function objectKey(row) {
  const extension = row.content_type === 'image/png' ? 'png' : 'jpg';
  const key = `${row.driver_id}/${row.trip_id}/${row.stage}/${row.capture_id}.${extension}`;
  if (row.storage_key !== `${BUCKET}/${key}` || !['start', 'end'].includes(row.stage) || !['image/jpeg', 'image/png'].includes(row.content_type)) fail();
  return key;
}
const storage = () => createAdminClient().storage.from(BUCKET);
async function tripFor(db, session, tripId, lock = false) {
  const { rows } = await db.query(`SELECT t.* FROM trips t WHERE t.trip_id=$1 AND t.deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [tripId]);
  owner(rows[0], session);
  return rows[0];
}
async function captureFor(db, captureId, lock = false) {
  return (await db.query(`SELECT * FROM trip_odometer_captures WHERE capture_id=$1${lock ? ' FOR UPDATE' : ''}`, [captureId])).rows[0];
}
async function ownedBytes(row, { signal } = {}) {
  try {
    signal?.throwIfAborted();
    const { data, error } = await storage().download(objectKey(row), {}, signal ? { signal } : undefined);
    signal?.throwIfAborted();
    if (error || !data || data.size > MAX_BYTES) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length !== row.byte_size || bytes.length > MAX_BYTES || hash(bytes) !== row.image_sha256 || validateImage({ type: row.content_type, size: bytes.length }, bytes).error) return null;
    return bytes;
  } catch { return null; }
}

// Also bounds transports that fail to honor AbortSignal. Their late resolution
// cannot resume the caller and begin a provider request after the lease expires.
async function abortable(promise, signal) {
  let abort;
  const cancelled = new Promise((_resolve, reject) => {
    abort = () => reject(signal.reason || new Error('Scan cancelled'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}
async function preview(row) {
  try {
    const key = objectKey(row);
    // Signing alone does not prove that an object still exists.
    if (!await ownedBytes(row)) return null;
    const { data, error } = await storage().createSignedUrl(key, 3600);
    return error ? null : data?.signedUrl || null;
  } catch { return null; }
}
async function safe(row) {
  return { capture_id: row.capture_id, trip_id: row.trip_id, stage: row.stage, state: row.state,
    reading_km: numeric(row.reading_km), unit: row.unit ?? null, preview_url: await preview(row),
    failure_code: row.failure_code ?? null, uploaded_at: row.uploaded_at };
}

/** Reserve one immutable image identity before uploading outside database locks. */
export async function uploadOdometerCapture({ session, tripId, stage, captureId, file }) {
  inputs(tripId, captureId, stage);
  captureId = captureId.toLowerCase();
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size || file.size > MAX_BYTES) fail('ODOMETER_RETAKE_REQUIRED', 422, 'Choose a JPEG or PNG photo up to 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateImage({ type: file.type, size: bytes.length }, bytes);
  if (validation.error || bytes.length > MAX_BYTES || !bytes.length) fail('ODOMETER_RETAKE_REQUIRED', 422, validation.error || 'The photo is too large.');
  const digest = hash(bytes);
  const row = await withTransaction(async tx => {
    // Serialize the rolling count across all capture IDs for this driver.
    await tx.query('SELECT pg_advisory_xact_lock(164, $1)', [session?.user?.driverId || 0]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`odometer:${captureId}`]);
    const trip = await tripFor(tx, session, tripId, true);
    const existing = await captureFor(tx, captureId, true);
    if (existing) {
      binding(existing, trip, session, stage);
      if (existing.image_sha256 !== digest || existing.content_type !== validation.contentType || existing.byte_size !== bytes.length) fail();
      if (existing.state !== 'committed') { phase(trip, stage); fresh(existing); }
      return existing;
    }
    phase(trip, stage);
    const count = await tx.query(`SELECT COUNT(*)::integer AS count FROM trip_odometer_captures WHERE driver_id=$1 AND trip_id=$2 AND stage=$3 AND uploaded_at>NOW()-INTERVAL '1 hour'`, [trip.driver_id, trip.trip_id, stage]);
    if (count.rows[0].count >= 10) fail('ODOMETER_RATE_LIMITED', 429, 'Too many photos. Please retry in one hour.');
    const key = `${BUCKET}/${trip.driver_id}/${trip.trip_id}/${stage}/${captureId}.${validation.extension}`;
    return (await tx.query(`INSERT INTO trip_odometer_captures(capture_id,trip_id,driver_id,vehicle_id,stage,storage_key,image_sha256,content_type,byte_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [captureId, trip.trip_id, trip.driver_id, trip.vehicle_id, stage, key, digest, validation.contentType, bytes.length])).rows[0];
  });
  if (row.state !== 'committed') {
    try {
      const result = await storage().upload(objectKey(row), bytes, { contentType: row.content_type, upsert: false });
      if (result.error && !await ownedBytes(row)) unavailable();
    } catch {
      // A timeout can hide a successful immutable upload. Reconcile exact bytes.
      if (!await ownedBytes(row)) unavailable();
    }
  }
  const trip = await tripFor({ query }, session, tripId);
  binding(row, trip, session, stage);
  return safe(row);
}

export async function readOdometerCapture({ session, tripId, captureId }) {
  inputs(tripId, captureId);
  const trip = await tripFor({ query }, session, tripId);
  const row = await captureFor({ query }, captureId);
  binding(row, trip, session);
  return safe(row);
}

/** Claim a 30-second lease, release locks for network work, then finalize by CAS. */
export async function scanOdometerCapture({ session, tripId, captureId, signal }) {
  inputs(tripId, captureId);
  const claim = await withTransaction(async tx => {
    const trip = await tripFor(tx, session, tripId, true);
    const row = await captureFor(tx, captureId, true);
    binding(row, trip, session);
    if (row.state === 'committed') return { row };
    phase(trip, row.stage); fresh(row);
    if (row.state === 'ready') return { row };
    if (row.state === 'scanning' && Date.now() - new Date(row.scan_started_at).getTime() < 30000) return { row };
    if (row.state === 'unreadable' || row.scan_attempts >= 3) fail('ODOMETER_RETAKE_REQUIRED', 422, 'Please take a new, clearer photo.');
    // pg decodes timestamps as JavaScript Dates (millisecond precision). Store
    // the lease at that precision so its equality token survives the round trip.
    const result = await tx.query(`UPDATE trip_odometer_captures SET state='scanning',scan_attempts=scan_attempts+1,scan_started_at=date_trunc('milliseconds',clock_timestamp()),failure_code=NULL WHERE capture_id=$1 RETURNING *`, [captureId]);
    return { row: result.rows[0], claimed: true };
  });
  if (!claim.claimed) return safe(claim.row);
  const controller = new AbortController();
  const abort = () => controller.abort();
  // Leave five seconds of the 30-second claim for database finalization. Both
  // Storage and Gemini share this deadline; provider's own 12s bound still holds.
  const deadline = Math.min(Date.now() + 25000, new Date(claim.row.scan_started_at).getTime() + 25000);
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted || Date.now() >= deadline) abort();
  let extraction;
  try {
    controller.signal.throwIfAborted();
    const bytes = await abortable(ownedBytes(claim.row, { signal: controller.signal }), controller.signal);
    if (!bytes) unavailable();
    if (Date.now() >= deadline) abort();
    controller.signal.throwIfAborted();
    extraction = await abortable(scanOdometerWithGemini(bytes, claim.row.content_type, { signal: controller.signal }), controller.signal);
    controller.signal.throwIfAborted();
  } catch { extraction = { failureCode: 'ODOMETER_SCAN_UNAVAILABLE' }; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  const row = await withTransaction(async tx => {
    const trip = await tripFor(tx, session, tripId, true);
    binding(claim.row, trip, session);
    const reading = { reading_km: extraction.readingKm, unit: extraction.unit, display_kind: extraction.displayKind };
    const usable = !extraction.failureCode && validReading(reading);
    const code = usable ? null : extraction.failureCode === 'ODOMETER_SCAN_UNAVAILABLE' ? 'ODOMETER_SCAN_UNAVAILABLE' : extraction.failureCode === 'ODOMETER_UNIT_UNSUPPORTED' ? 'ODOMETER_UNIT_UNSUPPORTED' : 'ODOMETER_RETAKE_REQUIRED';
    const result = await tx.query(`UPDATE trip_odometer_captures SET state=$4,reading_text=$5,reading_km=$6,unit=$7,display_kind=$8,failure_code=$9,model_name=$10,scan_version=$11,scanned_at=NOW() WHERE capture_id=$1 AND state='scanning' AND scan_started_at=$2 AND scan_attempts=$3 RETURNING *`,
      [captureId, claim.row.scan_started_at, claim.row.scan_attempts, usable ? 'ready' : code === 'ODOMETER_SCAN_UNAVAILABLE' ? 'failed' : 'unreadable', extraction.readingText ?? null, usable ? extraction.readingKm : null, ['km', 'mi', 'unknown'].includes(extraction.unit) ? extraction.unit : null, ['total', 'trip', 'unclear'].includes(extraction.displayKind) ? extraction.displayKind : null, code, extraction.modelName ?? null, extraction.scanVersion ?? null]);
    const current = result.rows[0] || await captureFor(tx, captureId);
    binding(current, trip, session);
    return current;
  });
  if (row.state === 'failed') unavailable();
  return safe(row);
}

/** Caller must hold current trip and vehicle locks; no network work occurs here. */
export async function consumeOdometerCapture({ tx, trip, session, stage, captureId }) {
  if (!captureId) fail('ODOMETER_PHOTO_REQUIRED', 409, 'Take and confirm an odometer photo first.');
  if (!['start', 'end'].includes(stage)) fail();
  inputs(trip.trip_id, captureId, stage);
  const row = await captureFor(tx, captureId, true);
  binding(row, trip, session, stage);
  if (row.state === 'committed' && row.committed_at) {
    if (!validReading(row)) fail();
    return { readingKm: Number(row.reading_km), captureId: row.capture_id };
  }
  const committed = await tx.query('SELECT capture_id FROM trip_odometer_captures WHERE trip_id=$1 AND stage=$2 AND committed_at IS NOT NULL', [trip.trip_id, stage]);
  if (committed.rows.length) fail();
  if (!validReading(row)) fail('ODOMETER_RETAKE_REQUIRED', 422, 'Please take a clearer total odometer photo in kilometres.');
  fresh(row);
  if (row.state !== 'ready') fail('ODOMETER_RETAKE_REQUIRED', 422, 'Read and confirm the odometer photo first.');
  // Task4 passes the locked vehicle mileage, never an earlier advisory read.
  const mileage = trip.vehicle_mileage ?? trip.current_mileage ?? trip.mileage;
  if (mileage == null || !Number.isFinite(Number(mileage))) fail();
  if (Number(row.reading_km) < Number(mileage) || (stage === 'end' && (trip.start_odometer == null || Number(row.reading_km) < Number(trip.start_odometer)))) fail('ODOMETER_CAPTURE_MISMATCH', 409, 'The reading is below the saved vehicle or starting odometer. Please retake the photo.');
  await tx.query("UPDATE trip_odometer_captures SET state='committed',committed_at=NOW() WHERE capture_id=$1 AND state='ready'", [captureId]);
  return { readingKm: Number(row.reading_km), captureId: row.capture_id };
}

/** Non-network acknowledgement only. Call before first-write gates and again under the trip lock. */
export async function replayOdometerCapture({ db = { query }, trip, session, stage, captureId }) {
  if (!captureId && !trip?.odometer_capture_required) return null;
  const rows = (await db.query('SELECT * FROM trip_odometer_captures WHERE trip_id=$1 AND stage=$2 AND committed_at IS NOT NULL', [trip.trip_id, stage])).rows;
  const row = rows[0];
  if (!row) return null;
  // An unlocked ownership read can precede another request's commit. Refresh
  // after seeing committed evidence, then recheck the current owner and binding.
  const current = await tripFor(db, session, trip.trip_id);
  if (row.capture_id !== captureId || row.state !== 'committed' || !validReading(row)) fail();
  binding(row, current, session, stage);
  return current;
}

/** Staff authorization belongs to the route. Only committed rows are evidence. */
export async function readTripOdometerEvidence({ tripId }) {
  if (!Number.isSafeInteger(Number(tripId)) || Number(tripId) <= 0) fail();
  const trip = (await query('SELECT * FROM trips WHERE trip_id=$1 AND deleted_at IS NULL', [tripId])).rows[0];
  if (!trip) fail('ODOMETER_CAPTURE_MISMATCH', 404, 'Trip not found.');
  const captures = (await query("SELECT * FROM trip_odometer_captures WHERE trip_id=$1 AND state='committed' AND committed_at IS NOT NULL", [tripId])).rows;
  const evidence = async stage => {
    const row = captures.find(c => c.stage === stage && Number(c.trip_id) === Number(tripId));
    if (row) {
      const url = await preview(row);
      return { reading_km: numeric(row.reading_km), recorded_at: row.committed_at, photo_url: url, photo_state: url ? 'available' : 'unavailable' };
    }
    const reading = numeric(stage === 'start' ? trip.start_odometer : trip.end_odometer);
    return reading == null ? null : { reading_km: reading, recorded_at: stage === 'start' ? trip.start_time ?? null : trip.end_time ?? null, photo_url: null, photo_state: 'not_recorded' };
  };
  return { start: await evidence('start'), end: await evidence('end'), distance_km: numeric(trip.distance), distance_source: trip.distance_provenance ?? null };
}
