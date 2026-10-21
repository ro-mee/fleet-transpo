import { requireDriver, AuthError, ok, handleError } from '@/lib/api/utils';
import { scanOdometerCapture } from '@/services/trip-odometer.service';

async function requireEmptyBody(req) {
  const invalid = () => new AuthError('The scan accepts no request body.', 400, 'BAD_REQUEST');
  if (req.signal?.aborted) throw invalid();
  if (!req.body) return;
  // Next's Node adapter exposes a stream even for Content-Length: 0. Accept
  // its empty EOF, without buffering content or waiting indefinitely for EOF.
  const reader = req.body.getReader();
  let rejectWait;
  const stopped = new Promise((_resolve, reject) => { rejectWait = reject; });
  const abort = () => rejectWait(invalid());
  const timer = setTimeout(abort, 1000);
  req.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (req.signal?.aborted) throw invalid();
    for (let chunks = 0; chunks < 8; chunks++) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) return;
      if (value.byteLength) throw invalid();
    }
    throw invalid();
  } catch {
    // Do not wait for an uncooperative peer's cancel handler.
    void reader.cancel().catch(() => {});
    throw invalid();
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export async function POST(req, { params }) {
  try {
    const session = await requireDriver(req);
    const { id, captureId } = await params;
    await requireEmptyBody(req);
    const result = await scanOdometerCapture({session, tripId: id, captureId, signal: req.signal});
    const response = ok(result, 200);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const response = handleError(error, 'Odometer capture request');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
