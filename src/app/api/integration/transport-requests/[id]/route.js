import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { detectRequestConflicts } from "@/lib/scheduling/conflicts";

// Read ONE transportation request — what the reservation detail page loads.
//
// The list GET returns the same shape for many rows, but a detail page needs two
// things a list cannot afford per row: the dispatch(es) raised from this request,
// and the review/approval actors resolved to names. Both are joined here so the
// page renders from a single response instead of fanning out.
//
// Read access is deliberately wider than write access. Reception and concierge
// hand guests to Fleet and get asked "where is the car?", so they can read a
// request; only the action endpoints narrow to the dispatcher set.
const READ_ROLES = [
  "system_admin",
  "admin",
  "fleet_manager",
  "dispatcher",
  "management",
  "reception_staff",
  "concierge",
];

export async function GET(req, { params }) {
  try {
    await requireAuth(req, READ_ROLES);
    const { id } = await params;

    const { rows } = await query(
      `SELECT tr.*,
              row_to_json(st.*)  AS service_types,
              row_to_json(v.*)   AS vehicles,
              row_to_json(vc.*)  AS vehiclecategories,
              CASE WHEN d.driver_id IS NULL THEN NULL ELSE
                json_build_object(
                  'driver_id',      d.driver_id,
                  'driver_status',  d.driver_status,
                  'license_number', d.license_number,
                  'license_expiry', d.license_expiry,
                  'phone',          de.phone,
                  'first_name',     de.first_name,
                  'last_name',      de.last_name
                )
              END AS drivers,
              -- Approval audit, resolved to names so the page needn't join employees.
              CASE WHEN rev.employee_id IS NULL THEN NULL ELSE
                json_build_object('first_name', rev.first_name, 'last_name', rev.last_name)
              END AS reviewer,
              CASE WHEN app.employee_id IS NULL THEN NULL ELSE
                json_build_object('first_name', app.first_name, 'last_name', app.last_name)
              END AS approver,
              -- Every dispatch raised from this request, newest first. Normally one;
              -- a re-dispatch after a cancellation makes it several, and hiding the
              -- earlier attempts would make the history unreadable.
              COALESCE((
                SELECT json_agg(x ORDER BY x.created_at DESC)
                FROM (
                  SELECT ds.dispatch_id, ds.dispatch_number, ds.status,
                         ds.scheduled_departure, ds.scheduled_arrival,
                         ds.actual_departure, ds.actual_arrival, ds.created_at,
                         dv.plate_number,
                         dde.first_name AS driver_first_name,
                         dde.last_name  AS driver_last_name,
                         t.trip_id, t.trip_status
                  FROM dispatchschedules ds
                  LEFT JOIN vehicles dv ON ds.vehicle_id = dv.vehicle_id
                  LEFT JOIN drivers dd  ON ds.driver_id = dd.driver_id
                  LEFT JOIN employees dde ON dd.employee_id = dde.employee_id
                  LEFT JOIN LATERAL (
                    SELECT trip_id, trip_status
                    FROM trips
                    WHERE dispatch_id = ds.dispatch_id AND deleted_at IS NULL
                    ORDER BY created_at DESC
                    LIMIT 1
                  ) t ON TRUE
                  WHERE ds.request_id = tr.request_id AND ds.deleted_at IS NULL
                ) x
              ), '[]'::json) AS dispatches
         FROM transportation_requests tr
         LEFT JOIN service_types st     ON tr.service_type_id = st.service_type_id
         LEFT JOIN vehicles v           ON tr.vehicle_id = v.vehicle_id
         LEFT JOIN vehiclecategories vc ON tr.requested_category_id = vc.category_id
         LEFT JOIN drivers d            ON tr.driver_id = d.driver_id
         LEFT JOIN employees de         ON d.employee_id = de.employee_id
         LEFT JOIN employees rev        ON tr.reviewed_by = rev.employee_id
         LEFT JOIN employees app        ON tr.approved_by = app.employee_id
        WHERE tr.request_id = $1 AND tr.deleted_at IS NULL
        LIMIT 1`,
      [id]
    );

    const request = rows[0];
    if (!request) return err("Transportation request not found", 404);

    // Conflicts are advisory here, exactly as on the queue: the assign endpoint
    // is what enforces them. A detection failure must not 500 the page, so the
    // request still returns with an empty findings list.
    let conflicts = [];
    try {
      conflicts = await detectRequestConflicts(request);
    } catch {
      conflicts = [];
    }

    return ok({ ...request, conflicts });
  } catch (e) { return handleError(e); }
}
