/**
 * The one SELECT/FROM pair every trips read route uses.
 *
 * This lived as a copy-pasted pair of template literals in three route files,
 * which is how all three ended up joining `t.origin_location_id` — a column
 * migration 007 promised in its header ("ADD location FK references to routes,
 * trips, reservations") and never added. Postgres raised
 * `column t.origin_location_id does not exist`, all three routes 500'd, and the
 * pages' useQuery fallbacks rendered the failure as empty state. One copy now,
 * so the next divergence is impossible rather than merely unlikely.
 */

/**
 * Origin and destination are NOT columns on trips: 007 dropped
 * trips.origin/destination on the reasoning that "these come from the route or
 * reservation". So they are resolved by joining outward — the originating
 * transportation request first, the route as fallback — which is the same
 * derivation the dispatch card does at src/components/dispatch/dispatch-card.jsx.
 *
 * The request is projected through an explicit json_build_object rather than
 * row_to_json(tr.*): that row carries guest name, booking reference, and
 * special requests, and the trips views need locations and identifiers only.
 * Widening this list is a deliberate act, not a side effect of `SELECT *`.
 *
 * The driver is likewise built by hand. row_to_json(d.*) returns the drivers
 * row alone, with no employees key, so every `drivers.employees.first_name`
 * read on the pages resolved to undefined and every Driver cell rendered blank.
 * Names live on employees; the join is what makes them reachable.
 */
export const TRIPS_SELECT = `
  t.*,
  row_to_json(v.*) AS vehicles,
  CASE WHEN d.driver_id IS NULL THEN NULL ELSE
    json_build_object(
      'driver_id',      d.driver_id,
      'driver_status',  d.driver_status,
      'license_number', d.license_number,
      'license_expiry', d.license_expiry,
      'first_name',     de.first_name,
      'last_name',      de.last_name
    )
  END AS drivers,
  row_to_json(ds.*) AS dispatchschedules,
  row_to_json(r.*)  AS routes,
  CASE WHEN tr.request_id IS NULL THEN NULL ELSE
    json_build_object(
      'request_id',         tr.request_id,
      'reservation_number', tr.reservation_number,
      'fleet_status',       tr.fleet_status,
      'pickup_location',    tr.pickup_location,
      'dropoff_location',   tr.dropoff_location,
      'passenger_count',    tr.passenger_count,
      'estimated_distance', tr.estimated_distance,
      'estimated_duration', tr.estimated_duration
    )
  END AS transportation_requests
`;

/**
 * transportation_requests is reached through dispatchschedules.request_id
 * (added by migration 015), so a trip created outside the dispatch flow simply
 * has no request and falls back to its route.
 */
export const TRIPS_JOINS = `
  FROM trips t
  LEFT JOIN vehicles v   ON t.vehicle_id = v.vehicle_id
  LEFT JOIN drivers d    ON t.driver_id = d.driver_id
  LEFT JOIN employees de ON d.employee_id = de.employee_id
  LEFT JOIN dispatchschedules ds ON t.dispatch_id = ds.dispatch_id
  LEFT JOIN routes r     ON t.route_id = r.route_id
  LEFT JOIN transportation_requests tr
    ON ds.request_id = tr.request_id AND tr.deleted_at IS NULL
`;
