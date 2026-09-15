import { requirePermission, handleError } from '@/lib/api/utils';
import { standbyLocations } from '@/services/standby.service';

export async function GET(req) {
  try {
    await requirePermission(req, 'trips', 'read_all');
    return Response.json(await standbyLocations(), { headers:{ 'Cache-Control':'private, no-store' } });
  } catch (error) { return handleError(error); }
}
