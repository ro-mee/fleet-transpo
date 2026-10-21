import { requireDriver, ok, handleError } from '@/lib/api/utils';
import { readOdometerCapture } from '@/services/trip-odometer.service';

export async function GET(req, { params }) {
  try {
    const session = await requireDriver(req);
    const { id, captureId } = await params;
    const result = await readOdometerCapture({session, tripId: id, captureId});
    const response = ok(result, 200);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const response = handleError(error, 'Odometer capture request');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
