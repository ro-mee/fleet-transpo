import { requireDriver, AuthError, ok, handleError } from '@/lib/api/utils';
import { uploadOdometerCapture } from '@/services/trip-odometer.service';

async function boundedForm(req) {
  const limit = 5242880 + 65536; // Image bound plus multipart headers/fields.
  if (Number(req.headers.get('content-length')) > limit) throw new AuthError('Photo must be no larger than 5 MB.', 422, 'ODOMETER_RETAKE_REQUIRED');
  const reader = req.body?.getReader();
  if (!reader) throw new AuthError('A photo is required.', 400, 'BAD_REQUEST');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AuthError('Photo must be no larger than 5 MB.', 422, 'ODOMETER_RETAKE_REQUIRED');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    return await new Response(new Blob(chunks), { headers: { 'Content-Type': req.headers.get('content-type') || '' } }).formData();
  } catch { throw new AuthError('Send a JPEG or PNG photo as multipart form data.', 400, 'BAD_REQUEST'); }
}

export async function POST(req, { params }) {
  try {
    const session = await requireDriver(req);
    const { id } = await params;
    const form = await boundedForm(req);
    if ([...form.keys()].some(key => !['image', 'stage', 'capture_id'].includes(key))) throw new AuthError('Only the photo, stage and capture ID are accepted.', 400, 'BAD_REQUEST');
    const result = await uploadOdometerCapture({session, tripId: id, stage: form.get('stage'), captureId: form.get('capture_id'), file: form.get('image')});
    const response = ok(result, 201);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const response = handleError(error, 'Odometer capture request');
    if (error.code === 'ODOMETER_RATE_LIMITED') response.headers.set('Retry-After', '3600');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
