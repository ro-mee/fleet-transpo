import { query } from "@/lib/db";
import { requirePermission, resolveIdentity, ok, err, handleError } from "@/lib/api/utils";
import { verifyServiceToken } from "@/lib/api/service-auth";
import { parseTransportationRequest } from "@/lib/integration/contracts";
import { ingestRequest } from "@/lib/integration/ingest";
import { detectConflictsForRequests } from "@/lib/scheduling/conflicts";
import { recomputeDerivedPriority } from "@/services/priority.service";
import { writeAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/auth/permissions";

// ============================================================================
// Inbound ingestion: Booking subsystem -> Fleet Reservation Queue.
//
// This is the dedicated boundary where transportation requests ENTER Fleet. It
// is separate from the in-app creation form (the human path) so that:
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
  const session = await resolveIdentity(req).catch(() => null);
  const role = session?.user?.role;
  if (session?.user && rolesFor("reservations", "create").includes(role)) {
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
//
// Pagination is opt-in. With page/pageSize/limit the route returns
// `{ rows, total, page, pageSize, counts }` using a lean projection (only the
// register's columns) and skips the derived-priority recompute and conflict
// scan — the register shouldn't pay for the queue's write + advisory work.
// Without those params it keeps the full, backward-compatible array for the
// queue / dashboard / analytics callers.
const OPEN_STATUSES = ["Pending", "Scheduled", "Assigned", "In Progress"];
const NEEDS_ASSIGNMENT = `(
  tr.fleet_status IN ('Pending', 'Scheduled', 'Assigned')
  AND (tr.vehicle_id IS NULL OR tr.driver_id IS NULL)
)`;

const TR_LIST_SELECT = `
  tr.request_id, tr.reservation_number, tr.booking_reference, tr.guest_name,
  tr.source_system, tr.pickup_location, tr.dropoff_location, tr.pickup_datetime,
  tr.priority, tr.passenger_count, tr.fleet_status, tr.requested_vehicle_type,
  tr.estimated_distance, tr.estimated_duration, tr.booking_status, tr.status_reason,
  CASE WHEN st.service_type_id IS NULL THEN NULL ELSE
    json_build_object('service_name', st.service_name)
  END AS service_types,
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number)
  END AS vehicles,
  CASE WHEN vc.category_id IS NULL THEN NULL ELSE
    json_build_object('category_name', vc.category_name)
  END AS vehiclecategories,
  CASE WHEN d.driver_id IS NULL THEN NULL ELSE
    json_build_object('driver_id', d.driver_id, 'first_name', de.first_name, 'last_name', de.last_name)
  END AS drivers
`;

const TR_ORDER_BY = `
  ORDER BY
    CASE tr.priority
      WHEN 'Urgent' THEN 1
      WHEN 'High'   THEN 2
      WHEN 'Medium' THEN 3
      WHEN 'Low'    THEN 4
      ELSE 5
    END,
    tr.pickup_datetime ASC
`;

// Whitelist of sortable columns for the register. Mapping id -> SQL expression
// keeps arbitrary user input out of ORDER BY.
const TR_SORTABLE = {
  reservation_number: "tr.reservation_number",
  guest_name: "tr.guest_name",
  pickup_datetime: "tr.pickup_datetime",
  priority: "tr.priority",
  passenger_count: "tr.passenger_count",
  fleet_status: "tr.fleet_status",
};

// ── Unified queue (card) projection + bucketing ────────────────────────────
//
// The queue is the dispatcher workspace: it renders rich cards (not a table),
// groups requests into six lifecycle tabs, and auto-sorts by derived priority.
// To avoid shipping every request (incl. hundreds of Completed rows) on each
// 30s poll, the queue fetches one tab at a time. This projection carries the
// fields ReservationCard actually renders; the bucket predicates mirror
// src/lib/scheduling/queue-grouping.js so grouping happens in SQL, not the
// browser.
const TR_CARD_SELECT = `
  tr.request_id, tr.reservation_number, tr.booking_reference, tr.guest_name,
  tr.source_system, tr.pickup_location, tr.dropoff_location, tr.pickup_datetime,
  tr.priority, tr.passenger_count, tr.fleet_status, tr.requested_vehicle_type,
  tr.estimated_distance, tr.estimated_duration, tr.booking_status, tr.status_reason,
  tr.special_requests, tr.created_at, tr.is_vip, tr.is_emergency,
  tr.derived_priority, tr.ai_driver_recommendation, tr.ai_vehicle_recommendation,
  CASE WHEN st.service_type_id IS NULL THEN NULL ELSE
    json_build_object('service_name', st.service_name)
  END AS service_types,
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number, 'model', v.model)
  END AS vehicles,
  CASE WHEN vc.category_id IS NULL THEN NULL ELSE
    json_build_object('category_name', vc.category_name, 'description', vc.description)
  END AS vehiclecategories,
  CASE WHEN d.driver_id IS NULL THEN NULL ELSE
    json_build_object('driver_id', d.driver_id, 'driver_status', d.driver_status,
      'license_expiry', d.license_expiry, 'first_name', de.first_name, 'last_name', de.last_name)
  END AS drivers
`;

// Mirrors the queue's auto-sort: derived priority rank first, then pickup time.
const TR_CARD_ORDER_BY = `
  ORDER BY
    CASE tr.derived_priority
      WHEN 'Overdue' THEN 1
      WHEN 'Critical' THEN 2
      WHEN 'High' THEN 3
      WHEN 'Medium' THEN 4
      WHEN 'Normal' THEN 5
      WHEN 'Future' THEN 6
      ELSE 7
    END,
    tr.pickup_datetime ASC NULLS LAST
`;

// Non-terminal statuses that still need dispatcher action. Requests outside this
// set and not terminal belong to Today/Upcoming, split by whether pickup is today.
const QUEUE_NON_TERMINAL_NOT = `tr.fleet_status NOT IN ('Assigned','In Progress','Completed','Cancelled')`;

// tab id -> SQL WHERE predicate for "this request belongs in that tab".
const QUEUE_TAB_PREDICATES = {
  inProgress: `tr.fleet_status = 'In Progress'`,
  assigned: `tr.fleet_status = 'Assigned'`,
  completed: `tr.fleet_status = 'Completed'`,
  cancelled: `tr.fleet_status = 'Cancelled'`,
  today: `(${QUEUE_NON_TERMINAL_NOT} AND (tr.pickup_datetime IS NULL OR tr.pickup_datetime::date = current_date))`,
  upcoming: `(${QUEUE_NON_TERMINAL_NOT} AND tr.pickup_datetime IS NOT NULL AND tr.pickup_datetime::date <> current_date)`,
};

const QUEUE_TABS = ["today", "upcoming", "assigned", "inProgress", "completed", "cancelled"];

// One row -> the six tab totals, so the KPI cards + tab badges never depend on
// fetching the whole set. Reuses the same predicates as the per-tab fetch.
const QUEUE_TAB_COUNTS_SQL = `
  SELECT
    count(*) FILTER (WHERE ${QUEUE_TAB_PREDICATES.today})     AS today,
    count(*) FILTER (WHERE ${QUEUE_TAB_PREDICATES.upcoming})   AS upcoming,
    count(*) FILTER (WHERE ${QUEUE_TAB_PREDICATES.assigned})   AS assigned,
    count(*) FILTER (WHERE ${QUEUE_TAB_PREDICATES.inProgress}) AS "inProgress",
    count(*) FILTER (WHERE ${QUEUE_TAB_PREDICATES.completed})  AS completed,
    count(*) FILTER (WHERE ${QUEUE_TAB_PREDICATES.cancelled})  AS cancelled
  FROM transportation_requests tr WHERE tr.deleted_at IS NULL
`;

export async function GET(req) {
  try {
    await requirePermission(req, "reservations", "read");
    const sp = new URL(req.url).searchParams;
    // A queue `tab` implies pagination too: the queue fetches one lifecycle tab
    // at a time instead of the whole set on every poll.
    const tab = sp.get("tab");
    const isQueueTab = tab && QUEUE_TAB_PREDICATES[tab];
    const wantsPagination = isQueueTab || sp.has("page") || sp.has("pageSize") || sp.has("limit");

    const params = [];
    let idx = 1;
    let where = " WHERE tr.deleted_at IS NULL";

    const status = sp.get("fleet_status");
    if (status && status !== "all_history") {
      // Comma-separated list supported so the UI can request several buckets.
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where += ` AND tr.fleet_status = $${idx++}`;
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        where += ` AND tr.fleet_status = ANY($${idx++})`;
        params.push(statuses);
      }
    }

    const source = sp.get("source_system");
    if (source) { where += ` AND tr.source_system = $${idx++}`; params.push(source); }

    const priority = sp.get("priority");
    if (priority) { where += ` AND tr.priority = $${idx++}`; params.push(priority); }

    const vehicleType = sp.get("requested_vehicle_type");
    if (vehicleType) { where += ` AND tr.requested_vehicle_type ILIKE $${idx++}`; params.push(`%${vehicleType}%`); }

    const categoryId = sp.get("requested_category_id");
    if (categoryId) { where += ` AND tr.requested_category_id = $${idx++}`; params.push(Number(categoryId)); }

    // Pickup date window. `pickup_date` matches a single day; from/to bound a range.
    const pickupDate = sp.get("pickup_date");
    if (pickupDate) {
      where += ` AND tr.pickup_datetime >= $${idx}::timestamptz AND tr.pickup_datetime < ($${idx}::timestamptz + INTERVAL '1 day')`;
      params.push(pickupDate);
      idx += 1;
    }
    const from = sp.get("from");
    if (from) { where += ` AND tr.pickup_datetime >= $${idx++}::timestamptz`; params.push(from); }
    const to = sp.get("to");
    if (to) { where += ` AND tr.pickup_datetime <= $${idx++}::timestamptz`; params.push(to); }

    // Tri-state assignment filters: "true" = assigned, "false" = unassigned.
    const hasVehicle = sp.get("has_vehicle");
    if (hasVehicle === "true") where += ` AND tr.vehicle_id IS NOT NULL`;
    else if (hasVehicle === "false") where += ` AND tr.vehicle_id IS NULL`;

    const hasDriver = sp.get("has_driver");
    if (hasDriver === "true") where += ` AND tr.driver_id IS NOT NULL`;
    else if (hasDriver === "false") where += ` AND tr.driver_id IS NULL`;

    if (sp.get("needs_assignment") === "true") where += ` AND ${NEEDS_ASSIGNMENT}`;

    // Free-text search across the fields a dispatcher would actually type.
    const search = sp.get("search");
    if (search) {
      where += ` AND (
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

    const FROM = `
      FROM transportation_requests tr
      LEFT JOIN service_types st ON tr.service_type_id = st.service_type_id
      LEFT JOIN vehicles v ON tr.vehicle_id = v.vehicle_id
      LEFT JOIN vehiclecategories vc ON tr.requested_category_id = vc.category_id
      LEFT JOIN drivers d ON tr.driver_id = d.driver_id
      LEFT JOIN employees de ON d.employee_id = de.employee_id`;

    // ── Paginated register / queue-tab read ────────────────────────────────
    if (wantsPagination) {
      const whereCount = params.length;
      const pageSize = Math.min(Math.max(parseInt(sp.get("limit") || sp.get("pageSize") || "25", 10) || 25, 1), 100);
      const page = Math.max(parseInt(sp.get("page") || "1", 10) || 1, 1);

      const sort = sp.get("sort");
      const sortDir = (sp.get("sortDir") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

      // Queue tabs filter + order by derived priority and only ship the cards
      // that tab needs. Register pages use the lean list projection + sort.
      let select = TR_LIST_SELECT;
      let orderBy = sort && TR_SORTABLE[sort]
        ? ` ORDER BY ${TR_SORTABLE[sort]} ${sortDir}`
        : TR_ORDER_BY;
      if (isQueueTab) {
        where += ` AND ${QUEUE_TAB_PREDICATES[tab]}`;
        select = TR_CARD_SELECT;
        orderBy = TR_CARD_ORDER_BY;
      }

      const [rowsRes, totalRes, countsRes] = await Promise.all([
        query(
          `SELECT ${select} ${FROM} ${where} ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`,
          [...params, pageSize, (page - 1) * pageSize]
        ),
        query(`SELECT count(*) AS total ${FROM} ${where}`, params.slice(0, whereCount)),
        // Queue tabs need all six tab totals for the KPI cards + tab badges; the
        // register needs its own open/review/today stat counts.
        isQueueTab
          ? query(QUEUE_TAB_COUNTS_SQL, [])
          : query(
              `SELECT
                 count(*) AS total,
                 count(*) FILTER (WHERE tr.fleet_status = ANY($1)) AS open,
                 count(*) FILTER (WHERE ${NEEDS_ASSIGNMENT}) AS review,
                 count(*) FILTER (
                   WHERE tr.pickup_datetime >= date_trunc('day', now())
                     AND tr.pickup_datetime < date_trunc('day', now()) + INTERVAL '1 day'
                 ) AS today
               FROM transportation_requests tr WHERE tr.deleted_at IS NULL`,
              [OPEN_STATUSES]
            ),
      ]);

      const rows = rowsRes.rows || [];

      // Queue tab: keep the derived-priority escalation + conflict chips working,
      // but only for the fetched page (small), never the whole set.
      if (isQueueTab && rows.length) {
        try {
          await recomputeDerivedPriority(rows);
        } catch (e) {
          console.warn("derived_priority recompute failed on queue tab:", e?.message || e);
        }
        if (new URL(req.url).searchParams.get("with_conflicts") === "true") {
          const byRequest = await detectConflictsForRequests(rows);
          rows.forEach((r) => {
            r.conflicts = byRequest.get(r.request_id) ?? [];
          });
        }
      }

      if (isQueueTab) {
        const c = countsRes.rows[0] || {};
        const tabs = {};
        for (const k of QUEUE_TABS) tabs[k] = Number(c[k]) || 0;
        return ok({
          rows,
          total: Number(totalRes.rows[0]?.total) || 0,
          page,
          pageSize,
          counts: { tabs },
        });
      }

      return ok({
        rows,
        total: Number(totalRes.rows[0]?.total) || 0,
        page,
        pageSize,
        counts: {
          total: Number(countsRes.rows[0]?.total) || 0,
          open: Number(countsRes.rows[0]?.open) || 0,
          review: Number(countsRes.rows[0]?.review) || 0,
          today: Number(countsRes.rows[0]?.today) || 0,
        },
      });
    }

    // ── Full list (queue / dashboard / analytics) ───────────────────────────
    const sql = `SELECT tr.*,
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
               ${FROM} ${where} ${TR_ORDER_BY}`;

    const { rows } = await query(sql, params);
    const requests = rows || [];

    // Recompute + persist derived_priority for the visible set so the queue's
    // ORDER BY reflects time-to-pickup and flags as of this read. Best-effort
    // (a recompute failure must not take the list down).
    if (requests.length) {
      try {
        await recomputeDerivedPriority(requests);
      } catch (e) {
        console.warn("derived_priority recompute failed on list:", e?.message || e);
      }
    }

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

    // Everything from here — idempotency, estimate, category, INSERT, number,
    // timeline, integration_log — is the shared ingest path, so a pushed
    // request and a pulled one are the same row. See lib/integration/ingest.js.
    const { idempotent, request: created } = await ingestRequest(request, {
      session: authz.session,
      actor: authz.actor,
      eventType: "transport_request_received",
    });
    if (idempotent) return ok({ ...created, idempotent: true }, 200);

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
