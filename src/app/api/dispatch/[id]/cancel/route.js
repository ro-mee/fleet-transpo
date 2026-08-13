import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertDispatchOwnership } from "@/lib/api/ownership";
import { setDispatchStatus } from "@/services/transition.service";
import { DISPATCH_STATUS as D } from "@/lib/constants";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher"];

// Stand a dispatch down. Goes through the transition service (validated, side
// effects: cancel open trips + the underlying request, release resources).
export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ROLES);
    const id = (await params).id;
    const body = await parseBody(req);
    await assertDispatchOwnership(session, id);
    return ok(await setDispatchStatus({
      dispatchId: id,
      to: D.CANCELLED,
      session,
      reason: body?.reason || null,
    }));
  } catch (e) { return handleError(e); }
}

export async function GET() {
  return new Response(null, { status: 405 });
}
