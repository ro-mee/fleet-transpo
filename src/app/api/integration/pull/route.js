import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { getBookingGateway } from "@/lib/integration/booking-gateway";
import { parseTransportationRequest } from "@/lib/integration/contracts";
import { normalizeInboundEnvelope } from "@/lib/integration/source-contract";
import { ingestRequest } from "@/lib/integration/ingest";
import { writeAudit } from "@/lib/audit";

// Pull transportation requests FROM the Booking gateway (mock or http) and
// ingest any that Fleet hasn't seen yet. Idempotent on (source_system,
// external_request_id), so pulling repeatedly cannot reuse a deleted source ID.
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
    let rejected = 0;
    const rejectionCodes = {};
    const created = [];

    for (const raw of incoming) {
      let request;
      let strictReplay = false;
      try {
        // Only the in-process mock may use fixture-declared identities. Every
        // other adapter must supply its trusted source principal explicitly.
        const sourceIdentity = gateway.name === "mock" ? raw?.source_system : gateway.sourceIdentity;
        if (typeof sourceIdentity !== "string" || !sourceIdentity.trim()) {
          throw new Error("Booking gateway has no trusted source identity");
        }
        if (raw?.contract_version === 2) {
          const envelope = normalizeInboundEnvelope(raw, sourceIdentity);
          if (envelope.event_kind !== "create" || envelope.external_revision !== 1) {
            const error = new Error("Unsupported v2 event or revision.");
            error.code = "SOURCE_REVISION_UNSUPPORTED";
            throw error;
          }
          request = envelope.request;
          strictReplay = true;
        } else {
          request = parseTransportationRequest({ ...raw, source_system: sourceIdentity });
        }
      } catch (error) {
        // One malformed item is skipped rather than failing the pull: a bad
        // record from Booking must not block the good ones behind it. The
        // push route answers its sender a 400 instead, which is why the
        // contract parse stays out here rather than inside ingestRequest.
        const code = error?.code;
        if (code === "SOURCE_REVISION_UNSUPPORTED") {
          skipped += 1;
          rejected += 1;
          rejectionCodes[code] = (rejectionCodes[code] || 0) + 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      let result;
      try {
        result = await ingestRequest(request, {
          session,
          actor: `gateway:${gateway.name}`,
          eventType: "transport_request_pulled",
          strictReplay,
        });
      } catch (error) {
        // Expected source-level conflicts reject this item, not the rest of a
        // trusted mock batch. Infrastructure/DB errors still fail the whole pull.
        const code = error?.code;
        if (!["SERVICE_UNAVAILABLE", "SOURCE_CREATE_CONFLICT", "SOURCE_ID_TOMBSTONED", "LOCATION_CODE_UNKNOWN", "LOCATION_CODE_RETIRED"].includes(code)) throw error;
        skipped += 1;
        rejected += 1;
        rejectionCodes[code] = (rejectionCodes[code] || 0) + 1;
        continue;
      }
      const { idempotent, request: row } = result;
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
        newValues: { ingested, rejected, rejectionCodes, via: `gateway:${gateway.name}` },
      });
    }

    if (rejected > 0) console.warn("Integration pull rejected source items:", { gateway: gateway.name, rejected, rejectionCodes });
    return ok({
      gateway: gateway.name,
      ingested,
      skipped,
      rejected,
      rejectionCodes,
      requests: created,
      message: `Pulled ${incoming.length} from Booking (${gateway.name}): ${ingested} new, ${skipped} skipped (${rejected} rejected).`,
    });
  } catch (e) { return handleError(e); }
}
