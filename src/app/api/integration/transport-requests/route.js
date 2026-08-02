import { query } from "@/lib/db";
import { auth } from "@/lib/auth";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { verifyServiceToken } from "@/lib/api/service-auth";
import { parseTransportationRequest } from "@/lib/integration/contracts";
import { fleetStatusFromBooking } from "@/lib/integration/status-map";
import { resolveVehicleCategory } from "@/lib/integration/category-resolver";
import { estimateTrip } from "@/lib/geo/distance";
import { detectConflictsForRequests } from "@/lib/scheduling/conflicts";
import { assignReservationNumber } from "@/lib/scheduling/reservation-number";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { RESERVATION_EVENT as E } from "@/lib/constants";
import { writeAudit } from "@/lib/audit";

// ============================================================================
// Inbound ingestion: Booking subsystem -> Fleet Reservation Queue.
//
// This is the dedicated boundary where transportation requests ENTER Fleet. It
// is intentionally separate from POST /api/reservations (the human path) so that:
//   - the machine contract is validated independently (contracts.js),
//   - ingestion is IDEMPOTENT on external_booking_id (retried/replayed webhooks
//     never create duplicates), and
//   - Fleet never "creates a hotel reservation" — it records a request it received.
//
// Auth is dual:
//   - service token in BOOKING_WEBHOOK_SECRET (Authorization: Bearer <secret>),
//     for the real Booking system / mock injector, OR
//   - an authenticated admin/dispatcher session (for the in-app dev injector).
// ============================================================================

async function authorize(req) {
  // 1) Service token (machine-to-machine).
  const secret = process.env.BOOKING_WEBHOOK_SECRET;
  if (secret) {
    const tokenResult = verifyServiceToken(req, secret);
    if (tokenResult.ok) return { actor: "service", session: null };
  }
  // 2) Fall back to a logged-in Fleet user (dev injector / manual replay).
  const session = await auth();
  const role = session?.user?.role;
  if (session?.user && ["system_admin", "admin", "fleet_manager", "dispatcher"].includes(role)) {
    return { actor: "user", session };
  }
  return null;
}

// GET — list the Fleet Reservation Queue (for the queue UI). Session-only.
//
// Joins the assigned vehicle/driver/category so the queue can render a full card
// per request without an N+1 fetch per row. Supports the Phase 12 search and
// filter params; unknown params are ignored rather than erroring, so the UI can
// add filters without a lockstep API change.
export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "reception_staff", "concierge"]);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT tr.*,
                      row_to_json(st.*) AS service_types,
                      row_to_json(v.*)  AS vehicles,
                      row_to_json(vc.*) AS vehiclecategories,
                      CASE WHEN d.driver_id IS NULL THEN NULL ELSE
                        json_build_object(
                          'driver_id', d.driver_id,
                          'driver_status', d.driver_status,
                          'license_expiry', d.license_expiry,
                          'first_name', de.first_name,
                          'last_name', de.last_name
                        )
                      END AS drivers
               FROM transportation_requests tr
               LEFT JOIN service_types st ON tr.service_type_id = st.service_type_id
               LEFT JOIN vehicles v ON tr.vehicle_id = v.vehicle_id
               LEFT JOIN vehiclecategories vc ON tr.requested_category_id = vc.category_id
               LEFT JOIN drivers d ON tr.driver_id = d.driver_id
               LEFT JOIN employees de ON d.employee_id = de.employee_id
               WHERE tr.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    const status = sp.get("fleet_status");
    if (status) {
      // Comma-separated list supported so the UI can request several buckets.
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        sql += ` AND tr.fleet_status = $${idx++}`;
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        sql += ` AND tr.fleet_status = ANY($${idx++})`;
        params.push(statuses);
      }
    }

    const source = sp.get("source_system");
    if (source) { sql += ` AND tr.source_system = $${idx++}`; params.push(source); }

    const priority = sp.get("priority");
    if (priority) { sql += ` AND tr.priority = $${idx++}`; params.push(priority); }

    const vehicleType = sp.get("requested_vehicle_type");
    if (vehicleType) { sql += ` AND tr.requested_vehicle_type ILIKE $${idx++}`; params.push(`%${vehicleType}%`); }

    const categoryId = sp.get("requested_category_id");
    if (categoryId) { sql += ` AND tr.requested_category_id = $${idx++}`; params.push(Number(categoryId)); }

    // Pickup date window. `pickup_date` matches a single day; from/to bound a range.
    const pickupDate = sp.get("pickup_date");
    if (pickupDate) {
      sql += ` AND tr.pickup_datetime >= $${idx}::timestamptz AND tr.pickup_datetime < ($${idx}::timestamptz + INTERVAL '1 day')`;
      params.push(pickupDate);
      idx += 1;
    }
    const from = sp.get("from");
    if (from) { sql += ` AND tr.pickup_datetime >= $${idx++}::timestamptz`; params.push(from); }
    const to = sp.get("to");
    if (to) { sql += ` AND tr.pickup_datetime <= $${idx++}::timestamptz`; params.push(to); }

    // Tri-state assignment filters: "true" = assigned, "false" = unassigned.
    const hasVehicle = sp.get("has_vehicle");
    if (hasVehicle === "true") sql += ` AND tr.vehicle_id IS NOT NULL`;
    else if (hasVehicle === "false") sql += ` AND tr.vehicle_id IS NULL`;

    const hasDriver = sp.get("has_driver");
    if (hasDriver === "true") sql += ` AND tr.driver_id IS NOT NULL`;
    else if (hasDriver === "false") sql += ` AND tr.driver_id IS NULL`;

    // Free-text search across the fields a dispatcher would actually type.
    const search = sp.get("search");
    if (search) {
      sql += ` AND (
        tr.reservation_number ILIKE $${idx}
        OR tr.guest_name ILIKE $${idx}
        OR tr.booking_reference ILIKE $${idx}
        OR tr.pickup_location ILIKE $${idx}
        OR tr.dropoff_location ILIKE $${idx}
        OR v.plate_number ILIKE $${idx}
        OR de.first_name ILIKE $${idx}
        OR de.last_name ILIKE $${idx}
      )`;
      params.push(`%${search}%`);
      idx += 1;
    }

    // Urgent first, then soonest pickup — the dispatcher's natural work order.
    sql += ` ORDER BY
               CASE tr.priority
                 WHEN 'Urgent' THEN 1
                 WHEN 'High'   THEN 2
                 WHEN 'Medium' THEN 3
                 WHEN 'Low'    THEN 4
                 ELSE 5
               END,
               tr.pickup_datetime ASC`;

    const { rows } = await query(sql, params);
    const requests = rows || [];

    // ?with_conflicts=true attaches the advisory conflict findings the queue
    // renders as chips. Opt-in because it costs four extra queries: callers that
    // only need the list (dropdowns, counts) shouldn't pay for it. Batched
    // rather than per-row — a queue of 40 would otherwise be an N+1 on a poll.
    if (new URL(req.url).searchParams.get("with_conflicts") === "true") {
      const byRequest = await detectConflictsForRequests(requests);
      return ok(
        requests.map((r) => ({ ...r, conflicts: byRequest.get(r.request_id) ?? [] }))
      );
    }

    return ok(requests);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    const authz = await authorize(req);
    if (!authz) return err("Unauthorized", 401);

    let raw;
    try {
      raw = await req.json();
    } catch {
      return err("Invalid JSON body", 400);
    }

    // Validate against the integration contract.
    let request;
    try {
      request = parseTransportationRequest(raw);
    } catch (e) {
      const message = e?.issues?.[0]?.message || "Invalid transportation request payload.";
      return err(message, 400);
    }

    const fleetStatus = fleetStatusFromBooking(request.booking_status);

    // IDEMPOTENCY: if we've already ingested this external_booking_id, return the
    // existing record (200) instead of inserting a duplicate.
    const existing = await query(
      `SELECT * FROM transportation_requests WHERE external_booking_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [request.external_booking_id]
    );
    if (existing.rows[0]) {
      return ok({ ...existing.rows[0], idempotent: true }, 200);
    }

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
          requested_vehicle_type, requested_category_id, estimated_distance, estimated_duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      session: authz.session,
      description: `Request received from ${created.source_system}.`,
      metadata: {
        external_booking_id: created.external_booking_id,
        booking_reference: created.booking_reference,
        actor: authz.actor,
        // How the vehicle class was derived. Recorded because it is an inference,
        // not something Booking stated: if a request is later questioned, the
        // timeline shows whether a human or a keyword match chose the category.
        requested_vehicle_type: created.requested_vehicle_type,
        requested_category_id: created.requested_category_id,
        category_name: category.categoryName,
        category_matched_on: category.matchedOn,
      },
    });

    // Record the inbound event for audit / reconciliation.
    await query(
      `INSERT INTO integration_log
         (direction, source_system, event_type, reference_type, reference_id, external_booking_id, payload, status, processed_at)
       VALUES ('inbound', $1, 'transport_request_received', 'transportation_request', $2, $3, $4, 'processed', NOW())`,
      [request.source_system, created.request_id, request.external_booking_id, JSON.stringify(request)]
    ).catch((e) => console.warn("inbound integration_log write failed:", e?.message || e));

    await writeAudit(req, authz.session, {
      action: "create",
      resource: "transportation_requests",
      resourceId: created.request_id,
      newValues: { external_booking_id: created.external_booking_id, fleet_status: created.fleet_status },
    });

    return ok(created, 201);
  } catch (e) {
    return handleError(e);
  }
}
