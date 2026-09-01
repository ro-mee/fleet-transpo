import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { setTripStatus } from "@/services/transition.service";
import { TRIP_STATUS } from "@/lib/constants";

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "update");
    const id = (await params).id;
    await assertTripOwnership(session, id);
    return ok(await setTripStatus({
      tripId: id,
      to: TRIP_STATUS.DROP_OFF,
      session,
      busy: true,
    }));
  } catch (e) { return handleError(e); }
}
