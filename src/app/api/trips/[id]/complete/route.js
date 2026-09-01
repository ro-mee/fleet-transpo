import { requirePermission, parseBody, ok, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { completeTrip } from "@/services/trip-lifecycle.service";

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "update");
    const id = (await params).id;
    const body = await parseBody(req);
    await assertTripOwnership(session, id);
    return ok(await completeTrip(id, session, { endOdometer: body.end_odometer, distance: body.distance, startOdometer: body.start_odometer }));
  } catch (e) { return handleError(e); }
}
