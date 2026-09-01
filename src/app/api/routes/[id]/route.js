import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { isId } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import {
  normalizeRoutePayload,
  resolveRouteEndpoints,
  ROUTE_ESTIMATE_SOURCES,
} from "@/services/route-resolver.service";
import { fetchTomTomEstimate } from "@/lib/tomtom";

class RouteRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function routeProjection() {
  return `
    SELECT r.*,
           row_to_json(ol.*) AS origin_location,
           row_to_json(dl.*) AS destination_location,
           (SELECT COUNT(*)::int FROM dispatchschedules d
             WHERE d.route_id = r.route_id AND d.deleted_at IS NULL) AS dispatch_count,
           (SELECT COUNT(*)::int FROM trips t
             WHERE t.route_id = r.route_id AND t.deleted_at IS NULL) AS trip_count,
           EXISTS (
             SELECT 1 FROM dispatchschedules d
              WHERE d.route_id = r.route_id AND d.deleted_at IS NULL
                AND COALESCE(d.updated_at, d.created_at) >= NOW() - INTERVAL '30 days'
           ) OR EXISTS (
             SELECT 1 FROM trips t
              WHERE t.route_id = r.route_id AND t.deleted_at IS NULL
                AND COALESCE(t.updated_at, t.created_at) >= NOW() - INTERVAL '30 days'
           ) AS used_last_30_days,
           (
             ol.latitude IS NOT NULL AND ol.longitude IS NOT NULL
             AND dl.latitude IS NOT NULL AND dl.longitude IS NOT NULL
           ) AS is_navigation_ready
      FROM routes r
      LEFT JOIN locations ol ON ol.location_id = r.origin_location_id
      LEFT JOIN locations dl ON dl.location_id = r.destination_location_id`;
}

async function loadRoute(db, id) {
  const { rows } = await db.query(
    `${routeProjection()} WHERE r.route_id = $1 AND r.deleted_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function loadRouteUsage(db, id) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM dispatchschedules WHERE route_id = $1)::int
       + (SELECT COUNT(*) FROM trips WHERE route_id = $1)::int AS usage_count`,
    [id]
  );
  return Number(rows[0]?.usage_count || 0);
}

export async function GET(req, { params }) {
  try {
    await requirePermission(req, "routes", "read");
    const id = (await params).id;
    if (!isId(id)) return err("Route id is invalid", 400);
    const route = await loadRoute({ query }, Number(id));
    if (!route) return err("Route not found", 404);
    return ok(route);
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "routes", "update");
    const id = (await params).id;
    if (!isId(id)) return err("Route id is invalid", 400);
    const body = await parseBody(req);
    const { payload, errors } = normalizeRoutePayload(body, { partial: true });
    if (Object.keys(errors).length) return errValidation(errors);

    const route = await withTransaction(async (tx) => {
      const currentResult = await tx.query(
        `SELECT * FROM routes WHERE route_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [Number(id)]
      );
      const current = currentResult.rows[0];
      if (!current) throw new RouteRequestError("Route not found", 404);

      const endpointTouched = ["origin", "destination", "origin_location_id", "destination_location_id"]
        .some((field) => Object.prototype.hasOwnProperty.call(payload, field));
      let endpoints = null;
      let endpointChanged = false;
      if (endpointTouched) {
        endpoints = await resolveRouteEndpoints(tx, {
          origin: Object.prototype.hasOwnProperty.call(payload, "origin") ? payload.origin : current.origin,
          destination: Object.prototype.hasOwnProperty.call(payload, "destination") ? payload.destination : current.destination,
          originLocationId: Object.prototype.hasOwnProperty.call(payload, "origin_location_id")
            ? payload.origin_location_id
            : (Object.prototype.hasOwnProperty.call(payload, "origin") ? null : current.origin_location_id),
          destinationLocationId: Object.prototype.hasOwnProperty.call(payload, "destination_location_id")
            ? payload.destination_location_id
            : (Object.prototype.hasOwnProperty.call(payload, "destination") ? null : current.destination_location_id),
        });
        if (!endpoints) throw new RouteRequestError("Select two different active locations for this route.", 400);

        const changed = Number(current.origin_location_id) !== endpoints.originLocationId
          || Number(current.destination_location_id) !== endpoints.destinationLocationId;
        endpointChanged = changed;
        if (changed) {
          const usage = await loadRouteUsage(tx, Number(id));
          if (usage > 0) {
            throw new RouteRequestError(
              "This route is already used by a dispatch or trip. Create a new route and deactivate the old one instead.",
              409
            );
          }
        }
      }

      const hasProvidedEstimate = payload.estimated_distance != null || payload.estimated_duration != null;
      const manualEstimate = payload.estimate_source === "Manual" || hasProvidedEstimate;
      const missingCurrentEstimate = current.estimated_distance == null || current.estimated_duration == null;
      if (!endpoints && !manualEstimate && missingCurrentEstimate) {
        endpoints = await resolveRouteEndpoints(tx, {
          origin: current.origin,
          destination: current.destination,
          originLocationId: current.origin_location_id,
          destinationLocationId: current.destination_location_id,
        });
      }
      if (endpoints && !manualEstimate && (endpointChanged || missingCurrentEstimate)) {
        const estimate = await fetchTomTomEstimate(
          [Number(endpoints.originLocation.latitude), Number(endpoints.originLocation.longitude)],
          [Number(endpoints.destinationLocation.latitude), Number(endpoints.destinationLocation.longitude)]
        );
        payload.estimated_distance = estimate?.distanceKm ?? null;
        payload.estimated_duration = estimate?.durationMin ?? null;
        payload.estimate_source = estimate ? "TomTom" : null;
      }

      const assignments = [];
      const values = [];
      const set = (column, value) => {
        assignments.push(`${column} = $${values.length + 1}`);
        values.push(value);
      };
      if (payload.route_name !== undefined) set("route_name", payload.route_name);
      if (endpoints) {
        set("origin", endpoints.origin);
        set("destination", endpoints.destination);
        set("origin_location_id", endpoints.originLocationId);
        set("destination_location_id", endpoints.destinationLocationId);
      }
      if (payload.estimated_distance !== undefined) set("estimated_distance", payload.estimated_distance);
      if (payload.estimated_duration !== undefined) set("estimated_duration", payload.estimated_duration);
      if (payload.status !== undefined) set("status", payload.status);

      const estimateChanged = payload.estimated_distance !== undefined || payload.estimated_duration !== undefined;
      const hasEstimate = (payload.estimated_distance !== undefined ? payload.estimated_distance : current.estimated_distance) != null
        || (payload.estimated_duration !== undefined ? payload.estimated_duration : current.estimated_duration) != null;
      if (payload.estimate_source !== undefined) {
        if (payload.estimate_source && !ROUTE_ESTIMATE_SOURCES.includes(payload.estimate_source)) {
          throw new RouteRequestError("Estimate source is invalid.", 400);
        }
        set("estimate_source", payload.estimate_source);
      } else if (estimateChanged) {
        set("estimate_source", hasEstimate ? "Manual" : null);
      }
      if (estimateChanged || payload.estimate_source !== undefined) set("estimate_updated_at", hasEstimate ? new Date() : null);
      set("updated_at", new Date());

      if (assignments.length === 1 && assignments[0] === "updated_at = $1") {
        throw new RouteRequestError("No valid route fields provided.", 400);
      }
      values.push(Number(id));
      await tx.query(
        `UPDATE routes SET ${assignments.join(", ")} WHERE route_id = $${values.length} AND deleted_at IS NULL`,
        values
      );
      return loadRoute(tx, Number(id));
    });

    await writeAudit(req, session, {
      action: "update",
      resource: "routes",
      resourceId: id,
      newValues: route,
    });
    return ok(route);
  } catch (e) {
    if (e instanceof RouteRequestError) return err(e.message, e.status);
    if (e?.code === "23505") return err("An active route already exists for this direction.", 409);
    return handleError(e);
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await requirePermission(req, "routes", "delete");
    const id = (await params).id;
    if (!isId(id)) return err("Route id is invalid", 400);
    const current = await loadRoute({ query }, Number(id));
    if (!current) return err("Route not found", 404);
    const usage = await loadRouteUsage({ query }, Number(id));
    if (usage > 0) return err("This route has dispatch or trip history. Deactivate it instead of archiving it.", 409);

    const { rows } = await query(
      `UPDATE routes
          SET deleted_at = NOW(), status = 'Inactive', updated_at = NOW()
        WHERE route_id = $1 AND deleted_at IS NULL
      RETURNING *`,
      [Number(id)]
    );
    if (!rows[0]) return err("Route not found", 404);
    await writeAudit(req, session, { action: "delete", resource: "routes", resourceId: id, oldValues: current });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
