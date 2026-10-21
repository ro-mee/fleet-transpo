import { requirePermission, ok, handleError } from '@/lib/api/utils';
import { readTripOdometerEvidence } from '@/services/trip-odometer.service';

export async function GET(req, { params }) {
  try {
    await requirePermission(req, 'trips', 'read_all');
    const { id } = await params;
    const result = await readTripOdometerEvidence({tripId: id});
    const response = ok(result, 200);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const response = handleError(error, 'Odometer capture request');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
