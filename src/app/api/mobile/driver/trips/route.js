import { query } from "@/lib/db";
import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { computeDepartureWindow } from "@/lib/scheduling/departure-window";
import { resolveEtaMinutes } from "@/lib/scheduling/start-window";
import { mergeDispatchPolicy } from "@/lib/dispatch-policy";
import { resolveCoordinatesWithDb } from "@/lib/geo/dynamic-locations";
import { getCoordinateProvenanceFields } from "@/lib/locations/coordinate-provenance";

/**
 * GET /api/mobile/driver/trips
 *
 * The home screen's work list. Always filtered to the token's own driver_id;
 * there is no driver_id parameter to override.
 *
 * ?status=pending|active|completed  (default: pending + active)
 * ?limit=  1..100, default 50
 */

// Mirrors the chk_trip_status constraint in 012_status_constraints.sql.
// "pending" is everything assigned-but-not-yet-acknowledged by the driver.
const STATUS_GROUPS = {
  pending: [
    "Pending",
    "Approved",
    "Assigned",
    "Vehicle Assigned",
    "Driver Assigned",
    "Dispatched",
  ],
  active: ["Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"],
  completed: ["Completed", "Cancelled"],
};
STATUS_GROUPS.all = [
  ...STATUS_GROUPS.pending,
  ...STATUS_GROUPS.active,
  ...STATUS_GROUPS.completed,
];

const V2_LOCATION_INTERNAL_FIELDS = [
  "_external_create_fingerprint",
  "_pickup_location_id", "_dropoff_location_id",
  "_pickup_registry_location_id", "_pickup_registry_is_active", "_pickup_registry_retired_at",
  "_pickup_registry_latitude", "_pickup_registry_longitude", "_pickup_proposal_present",
  "_dropoff_registry_location_id", "_dropoff_registry_is_active", "_dropoff_registry_retired_at",
  "_dropoff_registry_latitude", "_dropoff_registry_longitude", "_dropoff_proposal_present",
];

function v2Endpoint(row, endpoint) {
  const prefix = `_${endpoint}`;
  const linkedId = row[`${prefix}_location_id`];
  const registryId = row[`${prefix}_registry_location_id`];
  const registry = getCoordinateProvenanceFields({
    is_active: row[`${prefix}_registry_is_active`] === true
      && row[`${prefix}_registry_retired_at`] == null
      && linkedId != null
      && registryId != null
      && String(linkedId) === String(registryId),
    latitude: row[`${prefix}_registry_latitude`],
    longitude: row[`${prefix}_registry_longitude`],
  });
  if (registry.coordinate_provenance === "canonical_registry") {
    return {
      latitude: row[`${prefix}_registry_latitude`],
      longitude: row[`${prefix}_registry_longitude`],
      provenance: "canonical_registry",
    };
  }
  return {
    latitude: null,
    longitude: null,
    provenance: row[`${prefix}_proposal_present`] === true ? "pending_review" : "unknown",
  };
}

async function preTripStatus(tripId) {
  const { rows } = await query(
    `SELECT i.status FROM vehicleinspection i
       JOIN trips t ON t.trip_id = i.trip_id
      WHERE i.trip_id = $1
        AND i.inspection_type = 'Pre-Trip'
        AND i.driver_id = t.driver_id
        AND i.vehicle_id = t.vehicle_id
      ORDER BY i.created_at DESC, i.inspection_id DESC LIMIT 1`,
    [tripId]
  );
  return rows[0]?.status ?? null;
}

export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const sp = req.nextUrl.searchParams;

    const requested = sp.get("status");
    const statuses = requested
      ? STATUS_GROUPS[requested]
      : [...STATUS_GROUPS.pending, ...STATUS_GROUPS.active];
    if (!statuses) {
      return err(`Unknown status group '${requested}'`, 400);
    }

    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 100);

    const { rows } = await query(
      `SELECT t.trip_id, t.trip_status,
              COALESCE(r.origin, tr.pickup_location) AS origin,
              COALESCE(r.destination, tr.dropoff_location) AS destination,
              ol.latitude  AS origin_latitude,  ol.longitude  AS origin_longitude,
              dl.latitude  AS destination_latitude, dl.longitude AS destination_longitude,
              t.start_time, t.end_time,
              COALESCE(r.estimated_distance, tr.estimated_distance) AS estimated_distance,
              COALESCE(r.estimated_duration, tr.estimated_duration) AS estimated_duration,
              t.dispatch_id, t.notes, t.start_odometer,
              v.vehicle_id,
              v.plate_number,
              v.plate_number AS vehicle_plate,
              v.model,
              v.model AS vehicle_model,
              v.mileage AS current_mileage,
              r.route_id, r.route_name,
              ds.dispatch_number,
              ds.scheduled_departure AS departure_time,
              tr.guest_name AS passenger_name,
              tr.passenger_count,
              tr.load_type,
              tr.cargo_weight_kg,
              tr.cargo_description,
              st.service_code,
              st.service_name,
              v.operational_use,
              v.cargo_capacity_kg,
              tr.booking_reference,
              tr.special_requests,
              tr.external_create_fingerprint AS _external_create_fingerprint,
              tr.pickup_location_id AS _pickup_location_id,
              tr.dropoff_location_id AS _dropoff_location_id,
              tr.partner_pickup_location_proposal IS NOT NULL AS _pickup_proposal_present,
              tr.partner_dropoff_location_proposal IS NOT NULL AS _dropoff_proposal_present,
              pickup_registry.location_id AS _pickup_registry_location_id,
              pickup_registry.is_active AS _pickup_registry_is_active,
              pickup_registry.retired_at AS _pickup_registry_retired_at,
              pickup_registry.latitude AS _pickup_registry_latitude,
              pickup_registry.longitude AS _pickup_registry_longitude,
              dropoff_registry.location_id AS _dropoff_registry_location_id,
              dropoff_registry.is_active AS _dropoff_registry_is_active,
              dropoff_registry.retired_at AS _dropoff_registry_retired_at,
              dropoff_registry.latitude AS _dropoff_registry_latitude,
              dropoff_registry.longitude AS _dropoff_registry_longitude
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
         LEFT JOIN routes r   ON r.route_id = t.route_id
         LEFT JOIN locations ol ON ol.location_id = r.origin_location_id
         LEFT JOIN locations dl ON dl.location_id = r.destination_location_id
         LEFT JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id
         LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
         LEFT JOIN service_types st ON st.service_type_id = tr.service_type_id
         LEFT JOIN locations pickup_registry ON pickup_registry.location_id = tr.pickup_location_id
         LEFT JOIN locations dropoff_registry ON dropoff_registry.location_id = tr.dropoff_location_id
        WHERE t.driver_id = $1 AND t.deleted_at IS NULL
          AND t.trip_status = ANY($2)
        ORDER BY ds.scheduled_departure ASC NULLS LAST, t.trip_id ASC
        LIMIT $3`,
      [session.user.driverId, statuses, limit]
    );

    // V2 coordinates are only taken from active Fleet locations joined through
    // the request's explicit IDs. Partner text and proposals remain review data;
    // the legacy endpoint-text fallback below is retained for v1 rows only.
    const db = { query };
    for (const t of rows) {
      if (t._external_create_fingerprint != null) {
        const pickup = v2Endpoint(t, "pickup");
        const dropoff = v2Endpoint(t, "dropoff");
        t.origin_latitude = pickup.latitude;
        t.origin_longitude = pickup.longitude;
        t.destination_latitude = dropoff.latitude;
        t.destination_longitude = dropoff.longitude;
        t.pickup_location_provenance = pickup.provenance;
        t.dropoff_location_provenance = dropoff.provenance;
        if (pickup.provenance !== "canonical_registry" || dropoff.provenance !== "canonical_registry") {
          t.estimated_distance = null;
          t.estimated_duration = null;
        }
      } else {
        // Routeless legacy booking dispatches have no location rows to join, so
        // fill missing endpoints from the current registry/hotel/gazetteer chain.
        if (t.origin_latitude == null && t.origin) {
          const c = await resolveCoordinatesWithDb(db, t.origin);
          if (c) { t.origin_latitude = c.lat; t.origin_longitude = c.lng; }
        }
        if (t.destination_latitude == null && t.destination) {
          const c = await resolveCoordinatesWithDb(db, t.destination);
          if (c) { t.destination_latitude = c.lat; t.destination_longitude = c.lng; }
        }
      }
      V2_LOCATION_INTERNAL_FIELDS.forEach((field) => delete t[field]);
    }

    // Pre-trip + departure-window enrichment. Every pre-start trip (not yet
    // STARTED) gets the window fields so the app can show "when can I start".
    // ETA (a TomTom network call) is only computed for the one trip actually
    // awaiting START ROUTE (Driver Accepted), not the whole list.
    const preStart = rows.filter((t) =>
      [...STATUS_GROUPS.pending, "Driver Accepted"].includes(t.trip_status)
    );
    const actionable = preStart.find((t) => t.trip_status === "Driver Accepted");

    // ETA is resolved once (from the driver's current position) and reused.
    // The ladder itself (TomTom → haversine heuristic → stored estimate) is
    // the shared start-window resolver — the same one the start gate and the
    // start-window notification producer use — so all three never drift.
    let driverPos = null;
    const resolveEta = async (trip) => {
      if (trip.eta_to_pickup_min != null) return trip.eta_to_pickup_min;
      const dest = trip.origin_latitude != null
        ? [Number(trip.origin_latitude), Number(trip.origin_longitude)]
        : null;
      if (!driverPos) {
        const { rows: pos } = await query(
          `SELECT current_latitude, current_longitude FROM drivers WHERE driver_id = $1 LIMIT 1`,
          [session.user.driverId]
        );
        driverPos = pos[0]?.current_latitude != null
          ? [Number(pos[0].current_latitude), Number(pos[0].current_longitude)]
          : null;
      }
      const eta = await resolveEtaMinutes({
        driverPosition: driverPos,
        pickupPosition: dest,
        storedDurationMinutes: trip.estimated_duration,
      });
      trip.eta_to_pickup_min = eta;
      return eta;
    };

    const policy = mergeDispatchPolicy(
      (await query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'dispatch_policy' LIMIT 1`
      )).rows[0]?.setting_value
    );

    for (const t of preStart) {
      t.pre_trip_status = await preTripStatus(t.trip_id);
      
      if (!t.departure_time) continue;
      const etaMinutes = await resolveEta(t);
      const window = computeDepartureWindow({
        pickup: t.departure_time,
        etaMinutes,
        departureBufferMinutes: policy.departureBufferMinutes,
        earlyStartAllowanceMinutes: policy.earlyStartAllowanceMinutes,
      });
      t.recommended_departure = window?.recommended_departure ?? null;
      t.earliest_start = window?.earliest_start ?? null;
      t.latest_start = window?.latest_start ?? null;
      t.eta_to_pickup_min = window?.eta_minutes ?? etaMinutes ?? null;
    }

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
