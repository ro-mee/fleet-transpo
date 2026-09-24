import { isId } from "@/lib/validation/helpers";
import { estimateTrip } from "@/lib/geo/distance";
import { fetchTomTomEstimate } from "@/lib/tomtom";

export const ROUTE_ESTIMATE_SOURCES = ["TomTom", "Manual", "Legacy / Unknown"];

export function normalizePlaceName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanLabel(value) {
  const label = String(value ?? "").trim().replace(/\s+/g, " ");
  return label || null;
}

function positiveNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** The row with this `location_id`, or null. */
function pickById(rows, id) {
  if (id === null) return null;
  return rows.find((row) => Number(row.location_id) === Number(id)) || null;
}

/**
 * The one row whose normalized name equals `key`, or null.
 *
 * Exactly one, deliberately: two active locations can share a name, and guessing
 * between them is how a request ends up filed against the wrong place. Ambiguity
 * resolves to nothing, which callers already handle as an ad-hoc leg.
 */
function pickUniqueByName(rows, key) {
  const matches = rows.filter((row) => normalizePlaceName(row.name) === key);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve both endpoints to active location rows. Text matching is only used
 * when it is unambiguous; a failed match is deliberately returned as null so
 * callers can keep an ad-hoc request leg without registering a reusable route.
 *
 * `allowNameFallback` decides what an id MEANS. Off (the default) it is the
 * sole authority: a side given an id is matched by id and by nothing else, which
 * is what route creation relies on — a name fallback there would silently accept
 * a location the caller did not name. On, the id is a PREFERENCE: the name is
 * queried for that side too, and used when the id no longer resolves. That is the
 * shape a transportation request needs, because its link is durable across
 * renames and can therefore outlive the location it points at — a physical move
 * retires the old row, and a stale link must degrade to the stored text rather
 * than to nothing.
 */
export async function resolveRouteEndpoints(db, options = {}) {
  const {
    origin,
    destination,
    originLocationId,
    destinationLocationId,
    origin_location_id,
    destination_location_id,
    allowNameFallback = false,
  } = options;
  const originIdValue = originLocationId ?? origin_location_id;
  const destinationIdValue = destinationLocationId ?? destination_location_id;
  const originId = originIdValue == null || originIdValue === "" ? null : Number(originIdValue);
  const destinationId = destinationIdValue == null || destinationIdValue === "" ? null : Number(destinationIdValue);
  if ((originId !== null && !isId(originId)) || (destinationId !== null && !isId(destinationId))) return null;

  const values = [];
  const clauses = [];
  if (originId !== null) {
    values.push(originId);
    clauses.push(`location_id = $${values.length}`);
  }
  if (destinationId !== null) {
    values.push(destinationId);
    clauses.push(`location_id = $${values.length}`);
  }

  const names = [cleanLabel(origin), cleanLabel(destination)];
  const textKeys = names.map(normalizePlaceName);

  // One name clause per side that has a name AND is allowed one to be queried by
  // it: always when that side has no id, and additionally when `allowNameFallback`
  // is on. `byName` is what the pick below is gated on, so a name is never matched
  // against rows the query did not fetch for that side.
  const byName = [originId === null, destinationId === null].map(
    (hasNoId, index) => (hasNoId || allowNameFallback) && Boolean(textKeys[index])
  );
  const nameValues = [];
  byName.forEach((wanted, index) => {
    if (!wanted) return;
    nameValues.push(textKeys[index]);
    clauses.push(`lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $${values.length + nameValues.length}`);
  });
  values.push(...nameValues);

  if (!clauses.length) return null;
  const result = await db.query(
    `SELECT location_id, name, address, latitude, longitude
       FROM locations
      WHERE is_active = true AND (${clauses.join(" OR ")})
      ORDER BY location_id`,
    values
  );

  const rows = result.rows || [];
  // `byName` gates the fallback per side rather than enabling it globally: a name
  // is only ever matched against rows this query fetched for that side, and those
  // rows were only fetched because this side was allowed to be matched by name.
  const pick = (id, key, mayMatchByName) => {
    const byId = pickById(rows, id);
    if (byId) return byId;
    return mayMatchByName ? pickUniqueByName(rows, key) : null;
  };
  const originRow = pick(originId, textKeys[0], byName[0]);
  const destinationRow = pick(destinationId, textKeys[1], byName[1]);
  if (!originRow || !destinationRow || originRow.location_id === destinationRow.location_id) return null;

  return {
    origin: originRow.name,
    destination: destinationRow.name,
    originLocationId: Number(originRow.location_id),
    destinationLocationId: Number(destinationRow.location_id),
    originLocation: originRow,
    destinationLocation: destinationRow,
  };
}

/**
 * Resolve a request's stored pickup/drop-off TEXT to canonical locations and
 * write the resulting ids onto the request row.
 *
 * This is the write the link columns were added for and never had: the columns
 * exist as FKs to `locations` and were read and written by nothing, so every
 * resolution stayed name-only and renaming a location silently orphaned the
 * requests that referenced it by name.
 *
 * Deliberately NOT `resolveRouteEndpoints`: that function is both-or-null and
 * requires two DISTINCT endpoints, which is the rule for a routable ROUTE. A
 * request is not a route. `dropoff_location` is nullable, so a request carrying
 * only a pickup still links its pickup; and pickup == dropoff is a legitimate
 * round trip that simply is not a reusable route pair.
 *
 * Each side is therefore resolved independently, by the same matcher and the
 * same ambiguity rule (exactly one active location, or nothing).
 *
 * The UPDATE cannot clear an existing link and cannot rewrite a row that is
 * already correct: a side that did not resolve is COALESCEd away, and the WHERE
 * demands at least one side actually differ. Re-running is a no-op.
 *
 * Throws on a query failure rather than swallowing it; the caller decides
 * whether a missing link is worth failing for.
 *
 * @returns {Promise<{pickupLocationId: number|null, dropoffLocationId: number|null,
 *                    updated: boolean}|null>} null when nothing resolved.
 */
export async function linkRequestLocations(db, { requestId, pickup, dropoff } = {}) {
  const id = Number(requestId);
  if (!isId(id)) return null;

  const keys = [normalizePlaceName(pickup), normalizePlaceName(dropoff)];
  const wanted = [...new Set(keys.filter(Boolean))];
  if (!wanted.length) return null;

  const placeholders = wanted.map((_, index) => `$${index + 1}`).join(", ");
  const { rows } = await db.query(
    `SELECT location_id, name
       FROM locations
      WHERE is_active = true
        AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) IN (${placeholders})
      ORDER BY location_id`,
    wanted
  );

  const pickupRow = keys[0] ? pickUniqueByName(rows || [], keys[0]) : null;
  const dropoffRow = keys[1] ? pickUniqueByName(rows || [], keys[1]) : null;
  const pickupId = pickupRow ? Number(pickupRow.location_id) : null;
  const dropoffId = dropoffRow ? Number(dropoffRow.location_id) : null;
  if (pickupId === null && dropoffId === null) return null;

  const { rowCount } = await db.query(
    `UPDATE transportation_requests
        SET pickup_location_id  = COALESCE($1::integer, pickup_location_id),
            dropoff_location_id = COALESCE($2::integer, dropoff_location_id),
            updated_at = NOW()
      WHERE request_id = $3
        AND (($1::integer IS NOT NULL AND pickup_location_id IS DISTINCT FROM $1::integer)
          OR ($2::integer IS NOT NULL AND dropoff_location_id IS DISTINCT FROM $2::integer))`,
    [pickupId, dropoffId, id]
  );

  return { pickupLocationId: pickupId, dropoffLocationId: dropoffId, updated: (rowCount ?? 0) > 0 };
}

export async function findActiveRoute(db, endpoints) {
  if (!endpoints?.originLocationId || !endpoints?.destinationLocationId) return null;
  const { rows } = await db.query(
    `SELECT * FROM routes
      WHERE status = 'Active' AND deleted_at IS NULL
        AND origin_location_id = $1 AND destination_location_id = $2
      ORDER BY route_id LIMIT 1`,
    [endpoints.originLocationId, endpoints.destinationLocationId]
  );
  return rows[0] || null;
}

/**
 * Find the active canonical route or create one only after both endpoints have
 * resolved to location IDs. The partial unique index is the final concurrency
 * guard; a concurrent insert is re-read and returned as the winner.
 */
export async function resolveRouteForRequest(db, request, { createMissing = true } = {}) {
  const endpoints = await resolveRouteEndpoints(db, {
    origin: request?.pickup_location ?? request?.origin,
    destination: request?.dropoff_location ?? request?.destination,
    // A transportation request carries the durable link; a route-shaped object
    // carries the endpoint fields directly. Both are seeded, link first.
    originLocationId: request?.pickup_location_id ?? request?.origin_location_id,
    destinationLocationId: request?.dropoff_location_id ?? request?.destination_location_id,
    // The link is preferred, not authoritative: a request whose location was
    // retired must fall back to its stored text rather than to no route at all.
    allowNameFallback: true,
  });
  if (!endpoints) return null;

  const existing = await findActiveRoute(db, endpoints);
  if (existing || !createMissing) return existing;

  const distance = positiveNumber(request?.estimated_distance ?? request?.distance_km);
  const duration = positiveNumber(request?.estimated_duration ?? request?.estimated_duration_minutes);
  const source = ROUTE_ESTIMATE_SOURCES.includes(request?.estimate_source)
    ? request.estimate_source
    : (distance || duration ? "Legacy / Unknown" : null);
  const routeName = `${endpoints.origin} → ${endpoints.destination}`.slice(0, 255);

  try {
    const { rows } = await db.query(
      `INSERT INTO routes
         (route_name, origin, destination, origin_location_id, destination_location_id,
          estimated_distance, estimated_duration, estimate_source, estimate_updated_at,
          status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8::varchar IS NULL THEN NULL ELSE NOW() END,'Active',NOW(),NOW())
       ON CONFLICT (origin_location_id, destination_location_id)
         WHERE status = 'Active' AND deleted_at IS NULL
           AND origin_location_id IS NOT NULL AND destination_location_id IS NOT NULL
       DO NOTHING
       RETURNING *`,
      [
        routeName,
        endpoints.origin,
        endpoints.destination,
        endpoints.originLocationId,
        endpoints.destinationLocationId,
        distance,
        duration ? Math.round(duration) : null,
        source,
      ]
    );
    return rows[0] || await findActiveRoute(db, endpoints);
  } catch (error) {
    if (error?.code === "23505") return findActiveRoute(db, endpoints);
    throw error;
  }
}

export function normalizeRoutePayload(body = {}, { partial = false } = {}) {
  const payload = {};
  const errors = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const first = (...keys) => keys.find((key) => has(key));

  if (!partial || has("route_name")) {
    const name = cleanLabel(body.route_name);
    if (!name) errors.route_name = "Route name is required.";
    else if (name.length > 150) errors.route_name = "Route name must be at most 150 characters.";
    else payload.route_name = name;
  }

  for (const field of ["origin", "destination"]) {
    if (!has(field)) continue;
    const value = cleanLabel(body[field]);
    if (!value) errors[field] = `${field === "origin" ? "Origin" : "Destination"} is invalid.`;
    else if (value.length > 255) errors[field] = `${field === "origin" ? "Origin" : "Destination"} must be at most 255 characters.`;
    else payload[field] = value;
  }

  for (const field of ["origin_location_id", "destination_location_id"]) {
    if (!has(field)) continue;
    const value = Number(body[field]);
    if (!isId(value)) errors[field] = `${field === "origin_location_id" ? "Origin" : "Destination"} location is invalid.`;
    else payload[field] = value;
  }

  const distanceKey = first("estimated_distance", "distance_km");
  if (distanceKey) {
    const raw = body[distanceKey];
    if (raw === null || String(raw).trim() === "") payload.estimated_distance = null;
    else {
      const value = positiveNumber(raw);
      if (value === null) errors.estimated_distance = "Distance must be greater than zero.";
      else payload.estimated_distance = value;
    }
  }

  const durationKey = first("estimated_duration", "estimated_duration_minutes");
  if (durationKey) {
    const raw = body[durationKey];
    if (raw === null || String(raw).trim() === "") payload.estimated_duration = null;
    else {
      const value = positiveNumber(raw);
      if (value === null) errors.estimated_duration = "Estimated duration must be greater than zero.";
      else payload.estimated_duration = Math.round(value);
    }
  }

  if (has("estimate_source")) {
    if (body.estimate_source !== null && !ROUTE_ESTIMATE_SOURCES.includes(body.estimate_source)) {
      errors.estimate_source = `Estimate source must be one of: ${ROUTE_ESTIMATE_SOURCES.join(", ")}.`;
    } else payload.estimate_source = body.estimate_source;
  }

  if (has("status")) {
    if (!["Active", "Inactive"].includes(body.status)) errors.status = "Status must be Active or Inactive.";
    else payload.status = body.status;
  }

  if (!partial && !payload.origin_location_id && !payload.origin && !payload.destination_location_id && !payload.destination) {
    errors.origin = "Select an origin location.";
  }
  if (!partial && !payload.destination_location_id && !payload.destination) {
    errors.destination = "Select a destination location.";
  }

  if (Object.keys(errors).length === 0 && Object.keys(payload).length === 0) {
    errors.route = "No valid route fields provided.";
  }
  return { payload, errors };
}

export function routeHasCoordinates(route) {
  const origin = route?.origin_location;
  const destination = route?.destination_location;
  return [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude]
    .every((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
}

/**
 * Use the request's stored estimate when it exists; otherwise retain the
 * existing deterministic estimator as an explicitly labelled legacy fallback.
 * This keeps the pure recommendation scorer in lockstep with the request row.
 */
export function estimateForRequest(request) {
  const distance = positiveNumber(request?.estimated_distance);
  const duration = positiveNumber(request?.estimated_duration);
  if (distance !== null && duration !== null) {
    const source = ROUTE_ESTIMATE_SOURCES.includes(request?.estimate_source)
      ? request.estimate_source
      : "Legacy / Unknown";
    return {
      distanceKm: Number(distance.toFixed(2)),
      durationMin: Math.round(duration),
      confidence: source === "TomTom" ? "high" : "low",
      basis: `Stored ${source} estimate`,
      source,
    };
  }
  const legacy = estimateTrip(request?.pickup_location, request?.dropoff_location);
  return { ...legacy, source: "Legacy / Unknown" };
}

async function tomTomEstimate(endpoints, departAt) {
  if (!routeHasCoordinates({
    origin_location: endpoints?.originLocation,
    destination_location: endpoints?.destinationLocation,
  })) return null;
  return fetchTomTomEstimate(
    [Number(endpoints.originLocation.latitude), Number(endpoints.originLocation.longitude)],
    [Number(endpoints.destinationLocation.latitude), Number(endpoints.destinationLocation.longitude)],
    { departAt }
  );
}

/**
 * Resolve a request's canonical route estimate without creating a route for an
 * unknown destination. A configured directional route wins, then TomTom for
 * two real endpoint coordinates, then the existing legacy estimate.
 */
export async function resolveRequestEstimate(request, db, { persistRoute = false } = {}) {
  const endpoints = db ? await resolveRouteEndpoints(db, {
    origin: request?.pickup_location,
    destination: request?.dropoff_location,
    originLocationId: request?.pickup_location_id ?? request?.origin_location_id,
    destinationLocationId: request?.dropoff_location_id ?? request?.destination_location_id,
    allowNameFallback: true,
  }) : null;
  const route = endpoints && db ? await findActiveRoute(db, endpoints) : null;
  if (route && positiveNumber(route.estimated_distance) !== null && positiveNumber(route.estimated_duration) !== null) {
    return estimateForRequest({
      ...request,
      estimated_distance: route.estimated_distance,
      estimated_duration: route.estimated_duration,
      estimate_source: route.estimate_source,
    });
  }

  const resolved = await tomTomEstimate(endpoints, request?.pickup_datetime);
  const fallback = resolved || estimateForRequest(request);

  // A valid, known endpoint pair is safe to register for reuse. Unknown text
  // never reaches this branch, so ad-hoc booking legs remain request-scoped.
  if (persistRoute && endpoints && !route) {
    await resolveRouteForRequest(db, {
      ...request,
      estimated_distance: fallback.distanceKm,
      estimated_duration: fallback.durationMin,
      estimate_source: fallback.source,
    });
  } else if (
    persistRoute && route && route.estimate_source !== "Manual"
    && (route.estimated_distance == null || route.estimated_duration == null)
    && fallback.distanceKm != null && fallback.durationMin != null
  ) {
    await db.query(
      `UPDATE routes
          SET estimated_distance = $1, estimated_duration = $2,
              estimate_source = $3, estimate_updated_at = NOW(), updated_at = NOW()
        WHERE route_id = $4 AND estimate_source IS DISTINCT FROM 'Manual'`,
      [fallback.distanceKm, fallback.durationMin, fallback.source, route.route_id]
    );
  }
  return fallback;
}
