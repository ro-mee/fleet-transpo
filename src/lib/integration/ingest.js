import { query } from "@/lib/db";
import { fleetStatusFromBooking } from "@/lib/integration/status-map";
import { resolveVehicleCategory } from "@/lib/integration/category-resolver";
import { estimateTrip } from "@/lib/geo/distance";
import { assignReservationNumber } from "@/lib/scheduling/reservation-number";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { RESERVATION_EVENT as E } from "@/lib/constants";

// ============================================================================
// The ONE way a transportation request enters Fleet.
//
// Two routes carry requests in, and they used to insert different rows:
//   POST /api/integration/transport-requests  (push — Booking webhook/injector)
//   POST /api/integration/pull                (pull — gateway poll)
// Pull wrote 13 columns against push's 19, so a pulled request arrived with no
// vehicle category, no travel estimate, no reservation number and no timeline:
// the queue rendered it as a card with no vehicle class, and its history began
// at the first dispatcher action instead of at arrival. Both now call
// ingestRequest(), so a request is the same row whichever door it came through.
//
// Callers keep only what genuinely differs between the two doors: auth, how a
// contract violation is reported (400 vs skip-and-count), the integration_log
// event_type, and the audit row — pull writes one aggregate per operator click
// rather than one per item.
// ============================================================================

/**
 * Ingest one already-parsed transportation request.
 *
 * Takes the PARSED contract object, not the raw payload: the two callers
 * disagree about what a contract violation means (a webhook owes its sender a
 * 400 with the failing issue; a poll skips the item and keeps going), and that
 * belongs to the route rather than in here.
 *
 * @param {object} request              output of parseTransportationRequest()
 * @param {object} [opts]
 * @param {object|null} [opts.session]  actor session, recorded on the timeline
 * @param {string} [opts.actor]         "service" | "user" | "gateway:<name>"
 * @param {string} [opts.eventType]     integration_log.event_type, the one field
 *                                      that keeps pull and push distinguishable
 *                                      for reconciliation
 * @returns {Promise<{idempotent: boolean, request: object, category: object|null}>}
 */
export async function ingestRequest(
  request,
  { session = null, actor = "service", eventType = "transport_request_received" } = {}
) {
  // IDEMPOTENCY: an external_booking_id already on file is returned untouched
  // instead of inserted again, so a replayed webhook or a repeated poll over
  // the same gateway page cannot double a request. Selecting the whole row
  // (not just request_id) is what lets the push route answer its sender with
  // the record it already holds.
  const existing = await query(
    `SELECT * FROM transportation_requests WHERE external_booking_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [request.external_booking_id]
  );
  if (existing.rows[0]) {
    return { idempotent: true, request: existing.rows[0], category: null };
  }

  const fleetStatus = fleetStatusFromBooking(request.booking_status);

  // Estimate travel up front so the queue can sort and filter on it without
  // waiting for someone to open the AI panel. Advisory only (see lib/geo).
  const estimate = estimateTrip(request.pickup_location, request.dropoff_location);

  // Translate Booking's free-text vehicle wording into one of Fleet's own
  // categories. This is the anti-corruption step migration 016 added
  // requested_category_id for: the queue joins and filters on it, so a null
  // here is a card with no vehicle class on it. `special_requests` is consulted
  // as a fallback because Booking has historically written the class in there
  // as prose ("VIP guest") for want of a field to put it in — but the note is
  // never *rewritten*, since a guest's actual requests belong to the guest.
  const category = await resolveVehicleCategory(
    request.requested_vehicle_type,
    request.special_requests
  );

  const { rows } = await query(
    `INSERT INTO transportation_requests
       (external_booking_id, source_system, booking_reference, guest_name,
        pickup_location, dropoff_location, pickup_datetime, passenger_count,
        special_requests, service_type_id, priority, booking_status, fleet_status,
        requested_vehicle_type, requested_category_id, estimated_distance, estimated_duration,
        is_vip, is_emergency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      request.external_booking_id,
      request.source_system,
      request.booking_reference || null,
      request.guest_name || null,
      request.pickup_location,
      request.dropoff_location || null,
      request.pickup_datetime,
      request.passenger_count,
      request.special_requests || null,
      request.service_type_id || null,
      // Already translated to Fleet's vocabulary by parseTransportationRequest
      // ('Normal' -> 'Medium'); inserting Booking's raw value would violate
      // chk_transport_priority.
      request.priority,
      request.booking_status,
      fleetStatus,
      // Kept verbatim alongside the resolved id: the raw ask is the record of
      // what Booking wanted, and it is all the queue can show when the string
      // matched no category.
      request.requested_vehicle_type || null,
      category.categoryId,
      estimate.distanceKm,
      estimate.durationMin,
      request.is_vip === true,
      request.is_emergency === true,
    ]
  );
  const created = rows[0];

  // Human-facing identifier. Best-effort: a request without a number is still
  // fully usable, so a failure here must not fail the ingest.
  const reservationNumber = await assignReservationNumber(created.request_id);
  if (reservationNumber) created.reservation_number = reservationNumber;

  // Open the timeline with the arrival event.
  await recordReservationEvent({
    requestId: created.request_id,
    eventType: E.CREATED,
    toStatus: created.fleet_status,
    session,
    description: `Request received from ${created.source_system}.`,
    metadata: {
      external_booking_id: created.external_booking_id,
      booking_reference: created.booking_reference,
      actor,
      // How the vehicle class was derived. Recorded because it is an inference,
      // not something Booking stated: if a request is later questioned, the
      // timeline shows whether a human or a keyword match chose the category.
      requested_vehicle_type: created.requested_vehicle_type,
      requested_category_id: created.requested_category_id,
      category_name: category.categoryName,
      category_matched_on: category.matchedOn,
    },
  });

  // Record the inbound event for audit / reconciliation. event_type is the
  // caller's, so a reconciliation query can still tell a pushed request from a
  // pulled one. Best-effort: the request is already ingested, and losing the
  // log line must not undo it.
  await query(
    `INSERT INTO integration_log
       (direction, source_system, event_type, reference_type, reference_id, external_booking_id, payload, status, processed_at)
     VALUES ('inbound', $1, $2, 'transportation_request', $3, $4, $5, 'processed', NOW())`,
    [
      request.source_system,
      eventType,
      created.request_id,
      request.external_booking_id,
      JSON.stringify(request),
    ]
  ).catch((e) => console.warn(`${eventType} integration_log write failed:`, e?.message || e));

  return { idempotent: false, request: created, category };
}
