import { requirePermission, parseBody, ok, err, handleError } from '@/lib/api/utils';
import { internalReviewSchema } from '@/lib/cargo/contracts';
import { reviewInternalCargo } from '@/services/cargo-execution.service';

export async function POST(req, context) {
  try {
    const session = await requirePermission(req, 'cargo', 'review_internal');
    const { id } = await context.params;
    if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) return err('Choose a valid trip.', 400);
    const parsed = internalReviewSchema.safeParse(await parseBody(req));
    if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Check the review details.', 400);
    const result = await reviewInternalCargo(Number(id), parsed.data, session);
    const response = ok(Object.fromEntries(['execution_id','trip_id','version','pickup_state','delivery_state','can_depart','can_complete'].filter(key => result[key] !== undefined).map(key => [key, result[key]])));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error.code?.startsWith('CARGO_') && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleError(error, { req });
  }
}
