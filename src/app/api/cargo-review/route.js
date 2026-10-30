import { requirePermission, ok, err, handleError } from '@/lib/api/utils';
import { listInternalCargoReviews } from '@/services/cargo-review.service';

export async function GET(req) {
  try {
    await requirePermission(req, 'cargo', 'review_internal');
    const params = new URL(req.url).searchParams;
    const response = ok(await listInternalCargoReviews(Object.fromEntries(['page','limit','stage','search','trip_id'].map(key => [key, params.get(key)]))));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error.status === 400) return err(error.message, 400);
    return handleError(error, { req });
  }
}
