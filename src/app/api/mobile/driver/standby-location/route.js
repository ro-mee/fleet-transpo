import { requireDriver, parseBody, handleError } from '@/lib/api/utils';
import { query } from '@/lib/db';
import { publishStandby } from '@/services/standby.service';
export async function POST(req) {
  try {
    const { user } = await requireDriver(req);
    const body = await parseBody(req);
    if (body?.enabled === true) {
      await query('UPDATE drivers SET standby_tracking_enabled=true WHERE driver_id=$1', [user.driverId]);
      return Response.json({ enabled:true }, { headers:{ 'Cache-Control':'private, no-store' } });
    }
    if (body?.enabled === false) {
      await query('UPDATE drivers SET standby_tracking_enabled=false,standby_session_family=NULL WHERE driver_id=$1', [user.driverId]);
      return Response.json({ updated: false }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    return Response.json(await publishStandby(user, body), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleError(error); }
}
