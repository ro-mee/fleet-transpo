import { isId } from "@/lib/validation/helpers";
import { estimateTrip } from "@/lib/geo/distance";
import { buildRouteUrl, getServerKey } from "@/lib/tomtom";

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

/**
 * Resolve both endpoints to active location rows. Text matching is only used
 * when it is unambiguous; a failed match is deliberately returned as null so
 * callers can keep an ad-hoc request leg without registering a reusable route.
 */
export async function resolveRouteEndpoints(db, options = {}) {
  const {
    origin,
    destination,
    originLocationId,
    destinationLocationId,
    origin_location_id,
    destination_location_id,
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
  if (values.length < 2 && textKeys.some(Boolean)) {
    const nameValues = [];
    if (originId === null && textKeys[0]) {
      nameValues.push(textKeys[0]);
      clauses.push(`lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $${values.length + nameValues.length}`);
    }
    if (destinationId === null && textKeys[1]) {
      nameValues.push(textKeys[1]);
      clauses.push(`lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $${values.length + nameValues.length}`);
    }
    values.push(...nameValues);
  }

  if (!clauses.length) return null;
  const result = await db.query(
    `SELECT location_id, name, address, latitude, longitude
       FROM locations
      WHERE is_active = true AND (${clauses.join(" OR ")})
      ORDER BY location_id`,
    values
  );

  const rows = result.rows || [];
  const pick = (id, key) => {
    if (id != null) return rows.find((row) => Number(row.location_id) === Number(id)) || null;
    const matches = rows.filter((row) => normalizePlaceName(row.name) === key);
    return matches.length === 1 ? matches[0] : null;
  };
  const originRow = pick(originId, textKeys[0]);
  const destinationRow = pick(destinationId, textKeys[1]);
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
    originLocationId: request?.origin_location_id,
    destinationLocationId: request?.destination_location_id,
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

async function tomTomEstimate(endpoints) {
  if (!getServerKey() || !routeHasCoordinates({
    origin_location: endpoints?.originLocation,
    destination_location: endpoints?.destinationLocation,
  })) return null;

  try {
    const origin = [Number(endpoints.originLocation.latitude), Number(endpoints.originLocation.longitude)];
    const destination = [Number(endpoints.destinationLocation.latitude), Number(endpoints.destinationLocation.longitude)];
    const response = await fetch(buildRouteUrl(origin, destination), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const route = (await response.json())?.routes?.[0];
    const summary = route?.summary;
    if (summary?.lengthInMeters == null || summary?.travelTimeInSeconds == null) return null;
    return {
      distanceKm: Number((Number(summary.lengthInMeters) / 1000).toFixed(1)),
      durationMin: Math.round(Number(summary.travelTimeInSeconds) / 60),
      confidence: "high",
      basis: "TomTom",
      source: "TomTom",
    };
  } catch {
    return null;
  }
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
    originLocationId: request?.origin_location_id,
    destinationLocationId: request?.destination_location_id,
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

  const resolved = await tomTomEstimate(endpoints);
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
