import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import {
  normalizeRoutePayload,
  resolveRouteEndpoints,
  findActiveRoute,
  ROUTE_ESTIMATE_SOURCES,
} from "@/services/route-resolver.service";
import { fetchTomTomEstimate } from "@/lib/tomtom";
import { writeAudit } from "@/lib/audit";

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

export async function GET(req) {
  try {
    await requirePermission(req, "routes", "read");
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status") || "Active";
    if (!["all", "Active", "Inactive"].includes(status)) return err("Invalid route status filter", 400);

    let sql = `${routeProjection()} WHERE r.deleted_at IS NULL`;
    const params = [];
    let index = 1;
    if (status !== "all") {
      sql += ` AND r.status = $${index++}`;
      params.push(status);
    }
    const search = sp.get("search")?.trim();
    if (search) {
      sql += ` AND (r.route_name ILIKE $${index} OR r.origin ILIKE $${index} OR r.destination ILIKE $${index})`;
      params.push(`%${search}%`);
    }
    sql += " ORDER BY CASE WHEN r.status = 'Active' THEN 0 ELSE 1 END, r.route_name, r.route_id";
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "routes", "create");
    const body = await parseBody(req);
    const { payload, errors } = normalizeRoutePayload(body);
    if (Object.keys(errors).length) return errValidation(errors);

    const route = await withTransaction(async (tx) => {
      const endpoints = await resolveRouteEndpoints(tx, payload);
      if (!endpoints) throw new RouteRequestError("Select two different active locations for this route.", 400);

      const existing = await findActiveRoute(tx, endpoints);
      if (existing) {
        throw new RouteRequestError("An active route already exists for this direction. Deactivate it before creating a replacement.", 409);
      }

      const hasProvidedEstimate = payload.estimated_distance != null || payload.estimated_duration != null;
      if (!hasProvidedEstimate && payload.estimate_source !== "Manual") {
        const estimate = await fetchTomTomEstimate(
          [Number(endpoints.originLocation.latitude), Number(endpoints.originLocation.longitude)],
          [Number(endpoints.destinationLocation.latitude), Number(endpoints.destinationLocation.longitude)]
        );
        if (estimate) {
          payload.estimated_distance = estimate.distanceKm;
          payload.estimated_duration = estimate.durationMin;
          payload.estimate_source = "TomTom";
        } else if (payload.estimate_source) {
          payload.estimate_source = null;
        }
      }

      const hasEstimate = payload.estimated_distance != null || payload.estimated_duration != null;
      const estimateSource = payload.estimate_source ?? (hasEstimate ? "Manual" : null);
      if (estimateSource && !ROUTE_ESTIMATE_SOURCES.includes(estimateSource)) {
        throw new RouteRequestError("Estimate source is invalid.", 400);
      }
      const { rows } = await tx.query(
        `INSERT INTO routes
           (route_name, origin, destination, origin_location_id, destination_location_id,
            estimated_distance, estimated_duration, estimate_source, estimate_updated_at,
            status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8::varchar IS NULL THEN NULL ELSE NOW() END,$9,NOW(),NOW())
         RETURNING *`,
        [
          payload.route_name,
          endpoints.origin,
          endpoints.destination,
          endpoints.originLocationId,
          endpoints.destinationLocationId,
          payload.estimated_distance ?? null,
          payload.estimated_duration ?? null,
          estimateSource,
          payload.status || "Active",
        ]
      );
      return rows[0];
    });

    await writeAudit(req, session, {
      action: "create",
      resource: "routes",
      resourceId: route.route_id,
      newValues: route,
    });
    return ok(route, 201);
  } catch (e) {
    if (e instanceof RouteRequestError) return err(e.message, e.status);
    if (e?.code === "23505") return err("An active route already exists for this direction.", 409);
    return handleError(e);
  }
}
