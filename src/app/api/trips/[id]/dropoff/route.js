import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { setTripStatus } from "@/services/transition.service";
import { TRIP_STATUS } from "@/lib/constants";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "driver"];

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ROLES);
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
