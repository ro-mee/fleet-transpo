import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { TRIPS_LIST_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";

const ACTIVE_STATUSES = [
  "In Progress",
  "Trip Started",
  "At Pickup",
  "Passenger Onboard",
  "En Route",
  "Drop-off",
  "Arrived",
  "Driver Accepted",
];

// Whitelist of sortable columns. Mapping id -> SQL expression keeps arbitrary
// user input out of the ORDER BY clause.
const SORTABLE = {
  trip_id: "t.trip_id",
  start_time: "t.start_time",
  end_time: "t.end_time",
  trip_status: "t.trip_status",
  created_at: "t.created_at",
  vehicle: "v.plate_number",
  driver: "de.last_name",
  route: "r.route_name",
};

// Only these columns may be written by the client. Column names are never
// interpolated from the request body — that would allow SQL injection via
// crafted keys (e.g. `trip_status = 'Completed' --`).
export const TRIP_WRITABLE = [
  "vehicle_id",
  "driver_id",
  "dispatch_id",
  "route_id",
  "start_time",
  "end_time",
  "distance",
  "actual_duration",
  "trip_status",
  "start_odometer",
  "end_odometer",
  "fuel_consumed",
  "avg_speed",
  "max_speed",
  "idle_time",
  "notes",
  "created_by",
  "updated_by",
  "fuel_cost",
  "toll_fees",
  "parking_fees",
  "driver_cost",
  "maintenance_cost",
  "miscellaneous_cost",
  "total_cost",
  "cost_per_km",
  "on_time_completion",
  "time_variance",
  "fuel_efficiency",
  "smooth_driving_score",
  "customer_rating",
  "performance_notes",
];

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"]);
    const sp = new URL(req.url).searchParams;

    // Search matches trip id, vehicle plate, driver name, or route name.
    const search = sp.get("search");
    // Single-status filter. "Active" expands to the group of in-flight statuses.
    const status = sp.get("status") || sp.get("trip_status");

    let base = `${TRIPS_JOINS} WHERE t.deleted_at IS NULL`;
    const params = []; let idx = 1;

    const vid = sp.get("vehicle_id"); if (vid) { base += ` AND t.vehicle_id = $${idx++}`; params.push(+vid); }
    const did = sp.get("driver_id"); if (did) { base += ` AND t.driver_id = $${idx++}`; params.push(+did); }
    const fd = sp.get("from_date"); if (fd) { base += ` AND t.start_time >= $${idx++}`; params.push(fd); }
    const td = sp.get("to_date"); if (td) { base += ` AND t.start_time <= $${idx++}`; params.push(td); }

    if (status) {
      if (status === "Active") {
        base += ` AND t.trip_status = ANY($${idx++})`; params.push(ACTIVE_STATUSES);
      } else {
        base += ` AND t.trip_status = $${idx++}`; params.push(status);
      }
    }

    if (search) {
      base += ` AND (
        t.trip_id::text ILIKE $${idx} OR
        v.plate_number ILIKE $${idx} OR
        de.first_name ILIKE $${idx} OR
        de.last_name ILIKE $${idx} OR
        r.route_name ILIKE $${idx}
      )`;
      params.push(`%${search}%`);
      idx++;
    }

    // Global counts for the dashboard stat cards — independent of the current
    // filter/search, so the numbers stay stable while the table paginates.
    const countsSql = `SELECT
      count(*) AS total,
      count(*) FILTER (WHERE t.trip_status = ANY($1)) AS active,
      count(*) FILTER (WHERE t.trip_status = 'Completed') AS completed
      FROM trips t WHERE t.deleted_at IS NULL`;
    const countsParams = [ACTIVE_STATUSES];

    // Filtered count for the pagination footer (same WHERE as the rows query).
    const whereCount = params.length;
    const totalSql = `SELECT count(*) AS total ${base}`;

    // Pagination is opt-in. Without page/pageSize/limit the route returns the
    // full (non-deleted) set — legacy callers like the role dashboard and the
    // history page still pull everything for their summaries.
    const wantsPagination = sp.has("page") || sp.has("pageSize") || sp.has("limit");
    let rowsSql = `SELECT ${TRIPS_LIST_SELECT} ${base}`;
    let limit = null, offset = 0, page = 1, pageSize = 25;

    // Sorting — default to newest first. ORDER BY must precede LIMIT/OFFSET.
    const sort = sp.get("sort");
    const sortDir = (sp.get("sortDir") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const orderExpr = SORTABLE[sort] || "t.created_at";
    rowsSql += ` ORDER BY ${orderExpr} ${sortDir}, t.trip_id ${sortDir === "ASC" ? "ASC" : "DESC"}`;

    if (wantsPagination) {
      pageSize = Math.min(Math.max(parseInt(sp.get("limit") || sp.get("pageSize") || "25", 10) || 25, 1), 100);
      page = Math.max(parseInt(sp.get("page") || "1", 10) || 1, 1);
      limit = pageSize;
      offset = (page - 1) * pageSize;
      rowsSql += ` LIMIT $${idx++}`; params.push(limit);
      rowsSql += ` OFFSET $${idx++}`; params.push(offset);
    }

    const [rowsRes, totalRes, countsRes] = await Promise.all([
      query(rowsSql, params),
      query(totalSql, params.slice(0, whereCount)),
      query(countsSql, countsParams),
    ]);

    const total = Number(totalRes.rows[0]?.total) || 0;
    const counts = {
      total: Number(countsRes.rows[0]?.total) || 0,
      active: Number(countsRes.rows[0]?.active) || 0,
      completed: Number(countsRes.rows[0]?.completed) || 0,
    };

    return ok({ rows: rowsRes.rows, total, page, pageSize, counts });
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const body = await parseBody(req);
    const columns = [];
    const values = [];
    for (const key of TRIP_WRITABLE) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }
    if (columns.length === 0) return err("No valid fields provided", 400);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(`INSERT INTO trips (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`, values);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}