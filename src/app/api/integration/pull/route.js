import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { getBookingGateway } from "@/lib/integration/booking-gateway";
import { parseTransportationRequest } from "@/lib/integration/contracts";
import { ingestRequest } from "@/lib/integration/ingest";
import { writeAudit } from "@/lib/audit";

// Pull transportation requests FROM the Booking gateway (mock or http) and
// ingest any that Fleet hasn't seen yet. Idempotent on external_booking_id, so
// pulling repeatedly is safe — already-known requests are skipped.
//
// In development (BOOKING_GATEWAY=mock) this is how canned Booking requests land
// in the Fleet queue without a live Booking system. In production a scheduled
// poller (or a push webhook to /api/integration/transport-requests) plays this
// role. Session-gated to Fleet staff.
//
// The row itself is written by the shared ingest path (lib/integration/ingest.js),
// the same one the push webhook uses. This route owns only what is specific to
// polling: the gateway call, skipping a bad item instead of failing the batch,
// and one aggregate audit row per operator click.
export async function POST(req) {
  try {
    const session = await requirePermission(req, "integrations", "execute");

    const gateway = getBookingGateway();
    const incoming = await gateway.fetchPendingRequests();

    let ingested = 0;
    let skipped = 0;
    const created = [];

    for (const raw of incoming) {
      let request;
      try {
        request = parseTransportationRequest(raw);
      } catch {
        // One malformed item is skipped rather than failing the pull: a bad
        // record from Booking must not block the good ones behind it. The
        // push route answers its sender a 400 instead, which is why the
        // contract parse stays out here rather than inside ingestRequest.
        skipped += 1;
        continue;
      }

      const { idempotent, request: row } = await ingestRequest(request, {
        session,
        actor: `gateway:${gateway.name}`,
        eventType: "transport_request_pulled",
      });
      if (idempotent) {
        skipped += 1;
        continue;
      }

      created.push(row);
      ingested += 1;
    }

    // One audit row for the operator's action, not one per item — the click is
    // the thing that happened, and the per-request detail is on each timeline.
    if (ingested > 0) {
      await writeAudit(req, session, {
        action: "create",
        resource: "transportation_requests",
        newValues: { ingested, via: `gateway:${gateway.name}` },
      });
    }

    return ok({
      gateway: gateway.name,
      ingested,
      skipped,
      requests: created,
      message: `Pulled ${incoming.length} from Booking (${gateway.name}): ${ingested} new, ${skipped} already known.`,
    });
  } catch (e) { return handleError(e); }
}
