import { requirePermission, parseOptionalBody, ok, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { setTripStatus } from "@/services/transition.service";
import { TRIP_STATUS } from "@/lib/constants";

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "update");
    const id = (await params).id;
    // Optional: boarding far from the pickup geofence must carry an explicit
    // override + reason — enforced inside setTripStatus (409 otherwise).
    const body = await parseOptionalBody(req);
    await assertTripOwnership(session, id);
    return ok(await setTripStatus({
      tripId: id,
      to: TRIP_STATUS.PASSENGER_ONBOARD,
      session,
      busy: true,
      geofenceOverride: body.geofence_override === true,
      geofenceReason: body.geofence_reason,
    }));
  } catch (e) { return handleError(e); }
}
