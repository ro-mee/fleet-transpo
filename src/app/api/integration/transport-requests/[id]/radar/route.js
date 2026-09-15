import { requirePermission, handleError } from '@/lib/api/utils';
import { GET as recommendation } from '../recommendation/route';
import { standbyState } from '@/services/standby.service';
import { qualifiedGps } from '@/lib/dispatch/location-relevance';

export async function GET(req, context) {
  try {
    await requirePermission(req, 'reservations', 'assign');
    await requirePermission(req, 'dispatch', 'read_all');
    const response = await recommendation(req, context);
    if (!response.ok) return response;
    const result = await response.json();
    const pins = [];
    if (result.requestContext?.urgency === 'SHORT_NOTICE') {
      for (const pair of result.pair?.candidates ?? []) {
        if (pair.readiness !== 'VERIFIED' || !pair.dispatchContext?.liveLocationUsed || !pair.proximity || new Date(pair.proximity.expiresAt) < new Date()) continue;
        const state = await standbyState(pair.driver_id);
        const fix = { latitude:state?.standby_latitude,longitude:state?.standby_longitude,accuracy:state?.location_accuracy_m,observed_at:state?.location_observed_at };
        if (new Date(fix.observed_at).getTime() !== new Date(pair.proximity.gpsObservedAt).getTime()) continue;
        if (!state?.checked_in || !state.consented || state.busy || !state.session_live || !state.standby_tracking_enabled || Number(state.location_vehicle_id)!==Number(pair.vehicle_id) || !qualifiedGps(fix).eligible) continue;
        pins.push({ driverId:pair.driver_id,vehicleId:pair.vehicle_id,label:pair.vehicle.plate_number,
          latitude:Number(fix.latitude),longitude:Number(fix.longitude),etaMinutes:pair.proximity.etaMinutes,expiresAt:pair.proximity.expiresAt });
      }
    }
    return Response.json({ pins, evaluatedAt:result.evaluatedAt }, { headers:{ 'Cache-Control':'private, no-store' } });
  } catch (error) { return handleError(error); }
}
