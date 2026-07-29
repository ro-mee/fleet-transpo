import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";
import { logInboundEvent } from "@/services/integration.service";

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const data = await logInboundEvent({
      sourceSystem: body.source_system,
      eventType: body.event_type,
      referenceType: body.reference_type,
      referenceId: body.reference_id,
      externalBookingId: body.external_booking_id,
      payload: body.payload,
    });
    return ok(data, 201);
  } catch (e) { return handleError(e); }
}
