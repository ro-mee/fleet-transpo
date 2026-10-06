import { query } from "@/lib/db";
import { requirePermission, resolveIdentity, ok, err, handleError } from "@/lib/api/utils";
import { safeEqual } from "@/lib/api/service-auth";
import { normalizeInboundEnvelope } from "@/lib/integration/source-contract";
import { ingestRequest } from "@/lib/integration/ingest";
import { detectConflictsForRequests } from "@/lib/scheduling/conflicts";
import { recomputeDerivedPriority } from "@/services/priority.service";
import { writeAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/auth/permissions";
import { getCoordinateProvenanceFields } from "@/lib/locations/coordinate-provenance";

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
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (process.env.BOOKING_WEBHOOK_SECRET && process.env.POS_WEBHOOK_SECRET &&
      safeEqual(process.env.BOOKING_WEBHOOK_SECRET, process.env.POS_WEBHOOK_SECRET)) return null;
  for (const [source, secret] of [["PMS", process.env.BOOKING_WEBHOOK_SECRET], ["POS", process.env.POS_WEBHOOK_SECRET]]) {
    if (secret && token && safeEqual(token, secret)) {
      return { actor: "service", session: null, source };
    }
  }
  // Never fall back to a browser session when a caller presented an invalid token.
  if (header) return null;
  // 2) Fall back to a logged-in Fleet user (dev injector / manual replay).
  const session = await resolveIdentity(req).catch(() => null);
  const role = session?.user?.role;
  if (session?.user && rolesFor("reservations", "create").includes(role)) {
    return { actor: "user", session, source: "PMS" };
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

// `pickup_location_id` / `dropoff_location_id` are the durable link to
// `locations`, written at ingest and backfilled once for older rows. They are
// exposed so "the link is populated" is answerable from the API rather than
// only from SQL. The stored text above them stays the display value — it is
// Booking's own record of what Booking asked for, and a rename must not
// rewrite the parent system's words.
const LOCATION_COORDINATE_SELECT = `
  pickup_registry.is_active AS _pickup_registry_is_active,
  pickup_registry.retired_at AS _pickup_registry_retired_at,
  pickup_registry.latitude AS _pickup_registry_latitude,
  pickup_registry.longitude AS _pickup_registry_longitude,
  dropoff_registry.is_active AS _dropoff_registry_is_active,
  dropoff_registry.retired_at AS _dropoff_registry_retired_at,
  dropoff_registry.latitude AS _dropoff_registry_latitude,
  dropoff_registry.longitude AS _dropoff_registry_longitude
`;
const LOCATION_INTERNAL_FIELDS = [
  "_pickup_registry_is_active", "_pickup_registry_retired_at", "_pickup_registry_latitude", "_pickup_registry_longitude",
  "_dropoff_registry_is_active", "_dropoff_registry_retired_at", "_dropoff_registry_latitude", "_dropoff_registry_longitude",
];

function endpointProvenance(row, endpoint) {
  const registryPrefix = `_${endpoint}_registry`;
  const coordinateProvenance = getCoordinateProvenanceFields({
    is_active: row[`${registryPrefix}_is_active`] === true && row[`${registryPrefix}_retired_at`] == null,
    latitude: row[`${registryPrefix}_latitude`],
    longitude: row[`${registryPrefix}_longitude`],
  });
  if (coordinateProvenance.coordinate_provenance === "canonical_registry") return "canonical_registry";
  return row[`partner_${endpoint}_location_proposal`] == null ? "unknown" : "pending_review";
}

function projectLocationProvenance(rows) {
  return rows.map((row) => {
    const projected = {
      ...row,
      pickup_location_provenance: endpointProvenance(row, "pickup"),
      dropoff_location_provenance: endpointProvenance(row, "dropoff"),
    };
    LOCATION_INTERNAL_FIELDS.forEach((field) => delete projected[field]);
    return projected;
  });
}

const TR_LIST_SELECT = `
  tr.request_id, tr.reservation_number, tr.booking_reference, tr.guest_name,
  tr.source_system, tr.pickup_location, tr.dropoff_location, tr.pickup_datetime,
  tr.pickup_location_id, tr.dropoff_location_id,
  tr.partner_pickup_location_proposal, tr.partner_dropoff_location_proposal,
  ${LOCATION_COORDINATE_SELECT},
  tr.priority, tr.passenger_count, tr.load_type, tr.cargo_weight_kg,
  tr.cargo_description, tr.source_department, st.service_code,
  tr.fleet_status, tr.requested_vehicle_type,
  tr.estimated_distance, tr.estimated_duration, tr.booking_status, tr.status_reason,
  ds.dispatch_id, ds.dispatch_status,
  CASE WHEN st.service_type_id IS NULL THEN NULL ELSE
    json_build_object('service_name', st.service_name, 'service_code', st.service_code, 'default_load_type', st.default_load_type)
  END AS service_types,
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number)
  END AS vehicles,
  CASE WHEN vc.category_id IS NULL THEN NULL ELSE
    json_build_object('category_name', vc.category_name)
  END AS vehiclecategories,
  CASE WHEN d.driver_id IS NULL THEN NULL ELSE
    json_build_object('driver_id', d.driver_id, 'first_name', de.first_name, 'last_name', de.last_name,
      'face_image_url', d.face_image_url, 'avatar_url', de.avatar_url)
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
// Same link columns as TR_LIST_SELECT above, for the same reason.
const TR_CARD_SELECT = `
  tr.request_id, tr.reservation_number, tr.booking_reference, tr.guest_name,
  tr.source_system, tr.pickup_location, tr.dropoff_location, tr.pickup_datetime,
  tr.pickup_location_id, tr.dropoff_location_id,
  tr.partner_pickup_location_proposal, tr.partner_dropoff_location_proposal,
  ${LOCATION_COORDINATE_SELECT},
  tr.priority, tr.passenger_count, tr.load_type, tr.cargo_weight_kg,
  tr.cargo_description, tr.source_department, st.service_code,
  tr.fleet_status, tr.requested_vehicle_type,
  tr.estimated_distance, tr.estimated_duration, tr.booking_status, tr.status_reason,
  tr.special_requests, tr.created_at, tr.is_vip, tr.is_emergency,
  tr.derived_priority, tr.ai_driver_recommendation, tr.ai_vehicle_recommendation,
  ds.dispatch_id, ds.dispatch_status,
  CASE WHEN st.service_type_id IS NULL THEN NULL ELSE
    json_build_object('service_name', st.service_name, 'service_code', st.service_code, 'default_load_type', st.default_load_type)
  END AS service_types,
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number, 'model', v.model)
  END AS vehicles,
  CASE WHEN vc.category_id IS NULL THEN NULL ELSE
    json_build_object('category_name', vc.category_name, 'description', vc.description)
  END AS vehiclecategories,
  CASE WHEN d.driver_id IS NULL THEN NULL ELSE
    json_build_object('driver_id', d.driver_id, 'driver_status', d.driver_status,
      'license_expiry', d.license_expiry, 'first_name', de.first_name, 'last_name', de.last_name,
      'face_image_url', d.face_image_url, 'avatar_url', de.avatar_url)
  END AS drivers
`;

// Mirrors the queue's auto-sort: Pending Reassignment first (interrupted
// commitment the dispatcher must act on), then derived priority rank, then
// pickup time.
const TR_CARD_ORDER_BY = `
  ORDER BY
    CASE WHEN ds.dispatch_status = 'Pending Reassignment' THEN 0 ELSE 1 END,
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
  today: `(${QUEUE_NON_TERMINAL_NOT} AND (tr.pickup_datetime IS NULL OR (tr.pickup_datetime AT TIME ZONE 'Asia/Manila')::date <= (now() AT TIME ZONE 'Asia/Manila')::date))`,
  upcoming: `(${QUEUE_NON_TERMINAL_NOT} AND tr.pickup_datetime IS NOT NULL AND (tr.pickup_datetime AT TIME ZONE 'Asia/Manila')::date > (now() AT TIME ZONE 'Asia/Manila')::date)`,
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

    // Queue attention filter: only requests whose latest dispatch sits at
    // Pending Reassignment (incident/leave interrupt). Matches dashboard links
    // to /reservations/queue?filter=reassignment.
    if (sp.get("filter") === "reassignment") {
      where += ` AND ds.dispatch_status = 'Pending Reassignment'`;
    }

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

    // Latest non-deleted dispatch per request — the queue's reassignment signal
    // lives on dispatchschedules.status, not fleet_status (they deliberately
    // diverge while a run is interrupted).
    const FROM = `
      FROM transportation_requests tr
      LEFT JOIN locations pickup_registry ON pickup_registry.location_id = tr.pickup_location_id
      LEFT JOIN locations dropoff_registry ON dropoff_registry.location_id = tr.dropoff_location_id
      LEFT JOIN service_types st ON tr.service_type_id = st.service_type_id
      LEFT JOIN vehicles v ON tr.vehicle_id = v.vehicle_id
      LEFT JOIN vehiclecategories vc ON tr.requested_category_id = vc.category_id
      LEFT JOIN drivers d ON tr.driver_id = d.driver_id
      LEFT JOIN employees de ON d.employee_id = de.employee_id
      LEFT JOIN LATERAL (
        SELECT ds.dispatch_id, ds.status AS dispatch_status
          FROM dispatchschedules ds
         WHERE ds.request_id = tr.request_id AND ds.deleted_at IS NULL
         ORDER BY ds.dispatch_id DESC
         LIMIT 1
      ) ds ON true`;

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

      const rows = projectLocationProvenance(rowsRes.rows || []);

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
                      ${LOCATION_COORDINATE_SELECT},
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
    const requests = projectLocationProvenance(rows || []);

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
    let envelope;
    try {
      envelope = normalizeInboundEnvelope(raw, authz.source);
    } catch (e) {
      const message = e?.issues?.[0]?.message || "Invalid transportation request payload.";
      return err(message, 400);
    }

    // Later revisions and cancellations need a transactional event ledger and
    // lifecycle service; fail closed rather than silently accepting an update.
    if (envelope.event_kind !== "create" || envelope.external_revision !== 1) {
      return err("Update/cancel revisions require reconciliation; no request was changed.", 409);
    }
    const request = envelope.request;

    // Everything from here — idempotency, estimate, category, INSERT, number,
    // timeline, integration_log — is the shared ingest path, so a pushed
    // request and a pulled one are the same row. See lib/integration/ingest.js.
    const { idempotent, request: created } = await ingestRequest(request, {
      session: authz.session,
      actor: authz.actor,
      eventType: "transport_request_received",
      strictReplay: envelope.contract_version === 2,
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
    if (e?.code === "LOCATION_CODE_UNKNOWN") {
      return Response.json({ error: "Unknown location code.", code: e.code }, { status: 422 });
    }
    if (e?.code === "LOCATION_CODE_RETIRED") {
      return Response.json({ error: "Location code is retired.", code: e.code }, { status: 409 });
    }
    if (e?.code === "SERVICE_UNAVAILABLE") {
      return err("Unknown, inactive or incompatible service code.", 422);
    }
    if (e?.code === "SOURCE_ID_TOMBSTONED") {
      return err("This source request ID belongs to a deleted request and cannot be reused.", 409);
    }
    if (e?.code === "SOURCE_CREATE_CONFLICT") {
      return err("This source request ID has an unverified or different create payload; reconcile before retrying.", 409);
    }
    return handleError(e);
  }
}
