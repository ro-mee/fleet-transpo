import { createHash } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import { fleetStatusFromBooking } from "@/lib/integration/status-map";
import { resolveVehicleCategory } from "@/lib/integration/category-resolver";
import { resolveRequestEstimate, linkRequestLocations } from "@/services/route-resolver.service";
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
function rejectTombstone(row) {
  if (row.deleted_at) {
    const error = new Error("This source request ID belongs to a deleted request and cannot be reused.");
    error.code = "SOURCE_ID_TOMBSTONED";
    throw error;
  }
}

const CREATE_FIELDS = [
  "booking_reference", "guest_name", "pickup_location", "dropoff_location",
  "pickup_datetime", "passenger_count", "special_requests", "service_code", "load_type",
  "cargo_weight_kg", "cargo_description", "source_department",
  "pickup_location_code", "dropoff_location_code",
  "pickup_location_proposal", "dropoff_location_proposal",
  "priority", "booking_status", "requested_vehicle_type", "is_vip", "is_emergency",
];

async function resolveLocationCode(locationCode, dbQuery = query, { lock = false } = {}) {
  if (!locationCode) return null;
  const { rows } = await dbQuery(
    `SELECT location_id, is_active, retired_at
       FROM locations
      WHERE location_code = $1${lock ? " FOR SHARE" : ""}`,
    [locationCode]
  );
  const location = rows[0];
  if (!location) {
    const error = new Error("Unknown location code.");
    error.code = "LOCATION_CODE_UNKNOWN";
    throw error;
  }
  if (location.is_active !== true || location.retired_at != null) {
    const error = new Error("Location code is retired.");
    error.code = "LOCATION_CODE_RETIRED";
    throw error;
  }
  return location.location_id;
}

function createFingerprint(request) {
  const values = CREATE_FIELDS.map((key) => request[key] ?? null);
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function rejectChangedCreate(row, fingerprint) {
  if (fingerprint && row.external_create_fingerprint !== fingerprint) {
    const error = new Error("This source request ID has a different create payload; send an update revision instead.");
    error.code = "SOURCE_CREATE_CONFLICT";
    throw error;
  }
}

function withoutPartnerLocationProposals(row) {
  const response = { ...row };
  delete response.partner_pickup_location_proposal;
  delete response.partner_dropoff_location_proposal;
  return response;
}

export async function ingestRequest(
  request,
  { session = null, actor = "service", eventType = "transport_request_received", strictReplay = false } = {}
) {
  const fingerprint = strictReplay ? createFingerprint(request) : null;
  // IDEMPOTENCY: an existing source-scoped external_request_id is returned
  // untouched on exact replay instead of inserted again, so webhook retries
  // or repeat polls cannot double a request. Selecting the whole row
  // (not just request_id) is what lets the push route answer its sender with
  // the record it already holds.
  const existing = await query(
    `SELECT * FROM transportation_requests WHERE source_system = $1 AND external_request_id = $2 LIMIT 1`,
    [request.source_system, request.external_booking_id]
  );
  if (existing.rows[0]) {
    rejectTombstone(existing.rows[0]);
    rejectChangedCreate(existing.rows[0], fingerprint);
    return { idempotent: true, request: withoutPartnerLocationProposals(existing.rows[0]), category: null };
  }

  // V2 links are resolved only after replay/tombstone/fingerprint checks, so an
  // exact retry stays idempotent even if a registry code is retired later.
  const pickupLocationId = strictReplay ? await resolveLocationCode(request.pickup_location_code) : null;
  const dropoffLocationId = strictReplay ? await resolveLocationCode(request.dropoff_location_code) : null;

  let serviceTypeId = request.service_type_id || null;
  if (serviceTypeId != null && !request.service_code) {
    const { rows: services } = await query(
      `SELECT service_type_id, default_load_type FROM service_types WHERE service_type_id = $1 LIMIT 1`,
      [serviceTypeId]
    );
    if (!services[0]) {
      const error = new Error("Service ID is unknown or unavailable.");
      error.code = "SERVICE_UNAVAILABLE";
      throw error;
    }
    const catalogLoadType = services[0].default_load_type;
    if (catalogLoadType != null && catalogLoadType !== (request.load_type || "Passenger")) {
      const error = new Error("Service ID is incompatible with the request load type.");
      error.code = "SERVICE_UNAVAILABLE";
      throw error;
    }
  }
  if (request.service_code) {
    const { rows: services } = await query(
      `SELECT service_type_id, default_load_type FROM service_types
        WHERE service_code = $1 AND status = 'Active' AND deleted_at IS NULL LIMIT 1`,
      [request.service_code]
    );
    if (!services[0] || services[0].default_load_type !== request.load_type) {
      const error = new Error("Service code is unavailable or incompatible with the load type.");
      error.code = "SERVICE_UNAVAILABLE";
      throw error;
    }
    serviceTypeId = services[0].service_type_id;
  }

  const fleetStatus = fleetStatusFromBooking(request.booking_status);

  // V1 retains its text-based estimate and route linking. V2 estimates only
  // against the exact active registry IDs resolved from the supplied codes.
  const estimate = strictReplay
    ? await resolveRequestEstimate({
      ...request,
      pickup_location_id: pickupLocationId,
      dropoff_location_id: dropoffLocationId,
      partner_pickup_location_proposal: request.pickup_location_proposal ?? null,
      partner_dropoff_location_proposal: request.dropoff_location_proposal ?? null,
    }, { query }, { persistRoute: true, strictRegistry: true })
    : await resolveRequestEstimate(request, { query }, { persistRoute: true });

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

  const insertSql = `INSERT INTO transportation_requests
       (external_booking_id, source_system, booking_reference, guest_name,
        pickup_location, dropoff_location, pickup_datetime, passenger_count,
        special_requests, service_type_id, priority, booking_status, fleet_status,
        requested_vehicle_type, requested_category_id, estimated_distance, estimated_duration,
        is_vip, is_emergency, external_request_id, external_create_fingerprint,
         load_type, cargo_weight_kg, cargo_description, source_department,
         pickup_location_id, dropoff_location_id,
         partner_pickup_location_proposal, partner_dropoff_location_proposal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
     ON CONFLICT (source_system, external_request_id) DO NOTHING
     RETURNING *`;
  const insertParams = [
    request.external_booking_id,
    request.source_system,
    request.booking_reference || null,
    request.guest_name || null,
    request.pickup_location,
    request.dropoff_location || null,
    request.pickup_datetime,
    request.passenger_count,
    request.special_requests || null,
    serviceTypeId,
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
    request.external_booking_id,
    fingerprint,
    request.load_type || "Passenger",
    request.cargo_weight_kg ?? null,
    request.cargo_description ?? null,
    request.source_department ?? null,
    pickupLocationId,
    dropoffLocationId,
    request.pickup_location_proposal == null ? null : JSON.stringify(request.pickup_location_proposal),
    request.dropoff_location_proposal == null ? null : JSON.stringify(request.dropoff_location_proposal),
  ];
  let rows;
  if (strictReplay) {
    ({ rows } = await withTransaction(async (tx) => {
      const lockedPickupId = await resolveLocationCode(request.pickup_location_code, tx.query, { lock: true });
      const lockedDropoffId = await resolveLocationCode(request.dropoff_location_code, tx.query, { lock: true });
      const lockedParams = [...insertParams];
      lockedParams[25] = lockedPickupId;
      lockedParams[26] = lockedDropoffId;
      return tx.query(insertSql, lockedParams);
    }));
  } else {
    ({ rows } = await query(insertSql, insertParams));
  }
  if (!rows[0]) {
    const replay = await query(
      `SELECT * FROM transportation_requests WHERE source_system = $1 AND external_request_id = $2 LIMIT 1`,
      [request.source_system, request.external_booking_id]
    );
    if (!replay.rows[0]) throw new Error("Request identity conflict could not be resolved");
    rejectTombstone(replay.rows[0]);
    rejectChangedCreate(replay.rows[0], fingerprint);
    return { idempotent: true, request: withoutPartnerLocationProposals(replay.rows[0]), category: null };
  }
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

  // Legacy v1 keeps its best-effort text-based link. V2 links only through the
  // active location codes resolved above; its original text is never a lookup.
  if (!strictReplay) {
    await linkRequestLocations({ query }, {
      requestId: created.request_id,
      pickup: created.pickup_location,
      dropoff: created.dropoff_location,
    }).catch((e) => console.warn("request location link failed:", e?.message || e));
  }

  // Keep raw proposals on their dedicated request columns. The generic
  // integration log can be read outside the reservation queue, so do not copy
  // these review-only values into its payload.
  const integrationPayload = { ...request };
  delete integrationPayload.pickup_location_proposal;
  delete integrationPayload.dropoff_location_proposal;

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
      JSON.stringify(integrationPayload),
    ]
  ).catch((e) => console.warn(`${eventType} integration_log write failed:`, e?.message || e));

  return { idempotent: false, request: withoutPartnerLocationProposals(created), category };
}
