import { requireDriver, parseBody, handleError, err } from '@/lib/api/utils';
import { setDuty, standbyState } from '@/services/standby.service';
const reply = data => Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req) {
  try {
    const { user } = await requireDriver(req);
    const state = await standbyState(user.driverId);
    return reply({ checkedIn: state?.checked_in === true, busy: state?.busy === true });
  } catch (error) { return handleError(error); }
}
export async function POST(req) {
  try {
    const { user } = await requireDriver(req);
    const body = await parseBody(req);
    if (typeof body?.active !== 'boolean') return err('active must be a boolean', 400);
    return reply(await setDuty(user.driverId, body.active));
  } catch (error) { return handleError(error); }
}
