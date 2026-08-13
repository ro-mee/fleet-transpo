import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { cancelTrip } from "@/services/trip-lifecycle.service";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "driver"];

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ROLES);
    const id = (await params).id;
    const body = await parseBody(req);
    await assertTripOwnership(session, id);
    return ok(await cancelTrip(id, session, { reason: body?.reason || null }));
  } catch (e) { return handleError(e); }
}

export async function GET() {
  return new Response(null, { status: 405 });
}
