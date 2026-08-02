import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { getBookingGateway } from "@/lib/integration/booking-gateway";
import { parseTransportationRequest } from "@/lib/integration/contracts";
import { fleetStatusFromBooking } from "@/lib/integration/status-map";
import { writeAudit } from "@/lib/audit";

// Pull transportation requests FROM the Booking gateway (mock or http) and
// ingest any that Fleet hasn't seen yet. Idempotent on external_booking_id, so
// pulling repeatedly is safe — already-known requests are skipped.
//
// In development (BOOKING_GATEWAY=mock) this is how canned Booking requests land
// in the Fleet queue without a live Booking system. In production a scheduled
// poller (or a push webhook to /api/integration/transport-requests) plays this
// role. Session-gated to Fleet staff.
export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);

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
        skipped += 1;
        continue;
      }

      const existing = await query(
        `SELECT request_id FROM transportation_requests WHERE external_booking_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [request.external_booking_id]
      );
      if (existing.rows[0]) { skipped += 1; continue; }

      const fleetStatus = fleetStatusFromBooking(request.booking_status);
      const { rows } = await query(
        `INSERT INTO transportation_requests
           (external_booking_id, source_system, booking_reference, guest_name,
            pickup_location, dropoff_location, pickup_datetime, passenger_count,
            special_requests, service_type_id, priority, booking_status, fleet_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          request.external_booking_id, request.source_system, request.booking_reference || null,
          request.guest_name || null, request.pickup_location, request.dropoff_location || null,
          request.pickup_datetime, request.passenger_count, request.special_requests || null,
          request.service_type_id || null, request.priority, request.booking_status, fleetStatus,
        ]
      );
      created.push(rows[0]);
      ingested += 1;

      await query(
        `INSERT INTO integration_log
           (direction, source_system, event_type, reference_type, reference_id, external_booking_id, payload, status, processed_at)
         VALUES ('inbound', $1, 'transport_request_pulled', 'transportation_request', $2, $3, $4, 'processed', NOW())`,
        [request.source_system, rows[0].request_id, request.external_booking_id, JSON.stringify(request)]
      ).catch((e) => console.warn("pull integration_log write failed:", e?.message || e));
    }

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
