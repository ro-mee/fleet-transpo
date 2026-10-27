import { requirePermission, parseBody, ok, handleError } from '@/lib/api/utils';
import { createInternalCargoReservation } from '@/services/internal-reservation.service';

export async function POST(req) {
  let response;
  try {
    const session = await requirePermission(req, 'reservations', 'create');
    const result = await createInternalCargoReservation(await parseBody(req), session, { req });
    response = ok(result, result.idempotent ? 200 : 201);
  } catch (error) {
    response = handleError(error, { req });
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
