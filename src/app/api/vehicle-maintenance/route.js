import { appendMaintenanceSnapshot } from "@/services/maintenance-evidence.service";
import { isReviewedPlanRequest, reviewPlanWorkOrder } from "@/services/maintenance-plan-workorders.service";
import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, maintenanceDateRule, completionDateRule } from "@/lib/validation/helpers";
import { syncVehicleStatus } from "@/services/status.service";
import { MAX_ODOMETER_KM } from "@/lib/vehicles/odometer";
import { normalizeRoleName } from "@/lib/auth/role-names";
import { writeAppError } from "@/lib/app-errors";
import { writeAuditRequired } from "@/lib/audit";
import { isFuelDiagnosticPayload } from "@/lib/fuel/diagnostic";
import { ROLE_IDS } from "@/lib/constants";
import { fanoutMaintenanceNotification } from "@/lib/maintenance/notifications";
import { maintenanceAssigned, maintenanceUrgent } from "@/lib/notifications/copy";
import { notificationRolesFor, resolveNotificationRecipients } from "@/lib/notifications/recipients";
import { toCalendarDay } from "@/lib/dates";

// The API's field names, kept as-is so existing clients do not break, mapped to
// the columns that actually exist. Before this map, the schema accepted
// next_service_date / next_service_mileage / notes — none of which are columns
// — and assigned_to / completed_by, which have no column at all. Every such
// write failed at the DB.
//
// Provider identity (technician_name / service_center_name / service_provider /
// service_center) was removed 2026-10-13 with its columns: the register no
// longer captures where a repair happened, only who performed it
// (repair_completed_by) and what was done. Unknown body keys are dropped by
// the allowlist build below, never interpolated into SQL.
const FIELD_TO_COLUMN = {
  vehicle_id: "vehicle_id",
  maintenance_date: "maintenance_date",
  maintenance_type: "maintenance_type",
  description: "description",
  cost: "cost",
  status: "status",
  mileage_at_service: "mileage_at_service",
  next_service_date: "next_schedule_date",
  next_service_mileage: "next_schedule_mileage",
  priority: "priority",
  completed_date: "completed_date",
  notes: "remarks",
  next_schedule_date: "next_schedule_date",
  next_schedule_mileage: "next_schedule_mileage",
  remarks: "remarks",
  // P0 mechanic integration: staff may assign a mechanic at creation (PUT
  // already accepts this; the column exists, no migration). assigned_at is
  // server-stamped below and deliberately absent so a client value can never
  // reach the INSERT.
  assigned_mechanic_id: "assigned_mechanic_id",
};

// Lean projection for the paginated register. Only the columns the maintenance
// page renders + the detail dialog needs, instead of `vm.*` + `row_to_json(v.*)`.
// Task 4b adds the 9 timeline/evidence keys (assigned_at, repair_started_at,
// repair_completed_at, repair_completed_by, diagnosis, parts_replaced,
// labor_hours, rejection_reason, completed_date — completed_date was already
// here) plus source_inspection_id. The repair performer name is a display-only
// join for records; no additional employee details or mutation surface is added.
// Mechanic AND staff rows carry the same superset.
// P0 adds assigned_mechanic_id for BOTH roles: the staff edit dialog must
// seed its assign-mechanic select with the current assignee, and the staff
// list is the only source it reads. Staff already see cost and every other
// column, so carrying the assignee id discloses nothing new.
const MT_LIST_SELECT = `
  vm.maintenance_id, vm.vehicle_id, vm.maintenance_type, vm.maintenance_date,
  vm.completed_date, vm.status, vm.priority, vm.cost,
  vm.mileage_at_service, vm.description, vm.remarks, vm.created_at,
  vm.inspection_items, vm.inspection_outcomes, vm.source_incident_id, vm.source_inspection_id, vm.assigned_mechanic_id, vm.service_plan_id, vm.service_plan_version,
  vm.assigned_at, vm.repair_started_at, vm.repair_completed_at, vm.repair_completed_by,
  NULLIF(trim(concat_ws(' ', repairer.first_name, repairer.last_name)), '') AS repair_completed_by_name,
  vm.diagnosis, vm.parts_replaced, vm.labor_hours, vm.rejection_reason,
  (vm.status = 'Scheduled' AND vm.maintenance_date < (NOW() AT TIME ZONE 'Asia/Manila')::date) AS is_overdue,
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object('plate_number', v.plate_number, 'vehicle_name', v.vehicle_name)
  END AS vehicles
`;

const MT_FROM = `
  FROM vehiclemaintenance vm
  LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
`;

const MT_REPAIRER_JOIN = `LEFT JOIN employees repairer ON repairer.employee_id = vm.repair_completed_by`;

// Task 4 — mechanic reads always go through the lean projection above: `vm.*`
// + `row_to_json(v.*)` leaks purchase_price, image_url and the full vehicle
// row. P0 folds the mechanic assignment id into MT_LIST_SELECT itself (the
// staff edit dialog needs the current assignee), so both roles share one
// projection and this alias stays as the single reference the GET branches use.
const MT_MECHANIC_SELECT = MT_LIST_SELECT;

function mtLeanListSQL(select, where, orderBy, limitSql) {
  return `SELECT ${select} ${MT_FROM} ${MT_REPAIRER_JOIN} ${where} ${orderBy}${limitSql}`;
}

// PostgreSQL's DATE parser returns a JavaScript Date at local midnight. JSON
// serialization turns that into a UTC timestamp, which can look like the
// previous day in a date input (for example, Manila midnight becomes 16:00Z
// the day before). Keep date-only columns as calendar strings at the API edge.
function maintenanceRowsWithCalendarDates(rows) {
  return rows.map((row) => {
    const normalized = { ...row };
    for (const key of ["maintenance_date", "completed_date"]) {
      if (Object.hasOwn(normalized, key)) normalized[key] = toCalendarDay(normalized[key]);
    }
    return normalized;
  });
}

// Whitelist of sortable columns for the register. Maps the TanStack accessor id
// to a SQL expression so user input never reaches ORDER BY.
const MT_SORTABLE = {
  "vehicles.plate_number": "v.plate_number",
  maintenance_type: "vm.maintenance_type",
  maintenance_date: "vm.maintenance_date",
  status: "vm.status",
  priority: "vm.priority",
  cost: "vm.cost",
};

// Stat-card totals, computed server-side so the register never needs the whole set.
const MT_COUNTS_SQL = `
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE vm.status = 'Scheduled') AS scheduled,
    count(*) FILTER (
      WHERE vm.status = 'Scheduled'
        AND vm.maintenance_date < (NOW() AT TIME ZONE 'Asia/Manila')::date
    ) AS overdue,
    count(*) FILTER (WHERE vm.status IN ('In Progress', 'Pending Inspection')) AS "inProgress",
    COALESCE(SUM(vm.cost), 0) AS total_cost
  FROM vehiclemaintenance vm WHERE vm.deleted_at IS NULL
`;

const maintenanceWriteSchema = {
  vehicle_id: { required: true, type: "id", label: "Vehicle" },
  maintenance_date: { required: true, type: "date", label: "Maintenance date", validate: maintenanceDateRule },
  maintenance_type: { required: true, maxLength: 50, label: "Type" },
  description: { maxLength: 1000, label: "Description" },
  cost: { type: "positiveNumber", label: "Cost" },
  status: { maxLength: 30, label: "Status" },
  // Bounded, and completed_date carries its own no-future rule, because these
  // are the only two body fields recomputeVehicleSchedule feeds into the
  // vehicle's next_service_date / next_service_mileage — and that write is
  // clamped forward-only, so an out-of-range value here is not correctable by
  // filing a later record. Operations roles may provide these inputs; driver
  // self-service maintenance writes are not permitted here.
  mileage_at_service: { type: "positiveNumber", label: "Mileage at service", max: MAX_ODOMETER_KM },
  next_service_date: { type: "date", label: "Next service date" },
  next_service_mileage: { type: "positiveNumber", label: "Next service mileage", max: MAX_ODOMETER_KM },
  priority: { maxLength: 30, label: "Priority" },
  completed_date: { type: "date", label: "Completed date", validate: completionDateRule },
  notes: { maxLength: 1000, label: "Notes" },
  // Same fields under their column names, so the page's payload is validated as
  // strictly as an alias-using client's. validatePayload only walks the schema's
  // own keys, so without these three the page's values reach SQL unchecked.
  next_schedule_date: { type: "date", label: "Next service date" },
  next_schedule_mileage: { type: "positiveNumber", label: "Next service mileage", max: MAX_ODOMETER_KM },
  remarks: { maxLength: 1000, label: "Notes" },
  // P0: staff may assign at creation. Format-checked here; existence +
  // mechanic-role is verified against employees below (a format-valid id
  // pointing at nobody, or at a non-mechanic, is a 400, not a silent NULL).
  assigned_mechanic_id: { type: "id", label: "Assigned mechanic" },
};

export async function GET(req) {
  try {
    const session = await requirePermission(req, "maintenance", "read");
    const { searchParams } = new URL(req.url);
    // Task 4 — mechanics read only their own assigned rows (fail closed:
    // unassigned NULL rows match nobody). Staff filters below are untouched.
    const isMechanic = normalizeRoleName(session?.user?.role) === "mechanic";

    let where = " WHERE vm.deleted_at IS NULL";
    const params = [];
    let idx = 1;

    if (isMechanic) { where += ` AND vm.assigned_mechanic_id = $${idx++}`; params.push(session.user.employeeId); }

    const maintenanceId = searchParams.get("maintenance_id");
    if (maintenanceId !== null) {
      if (!/^[1-9]\d*$/.test(maintenanceId) || !Number.isSafeInteger(Number(maintenanceId))) return err("Invalid work order number", 400);
      where += ` AND vm.maintenance_id = $${idx++}`;
      params.push(Number(maintenanceId));
    }

    const vehicle_id = searchParams.get("vehicle_id");
    if (vehicle_id) { where += ` AND vm.vehicle_id = $${idx++}`; params.push(+vehicle_id); }

    const source_incident_id = searchParams.get("source_incident_id");
    if (/^\d+$/.test(source_incident_id || "")) { where += ` AND vm.source_incident_id = $${idx++}`; params.push(+source_incident_id); }

    const status = searchParams.get("status");
    if (status) { where += ` AND vm.status = $${idx++}`; params.push(status); }

    const from_date = searchParams.get("from_date");
    if (from_date) { where += ` AND vm.maintenance_date >= $${idx++}`; params.push(from_date); }

    const to_date = searchParams.get("to_date");
    if (to_date) { where += ` AND vm.maintenance_date <= $${idx++}`; params.push(to_date); }

    const search = searchParams.get("search");
    if (search) {
      where += ` AND (v.plate_number ILIKE $${idx} OR vm.maintenance_type ILIKE $${idx} OR vm.description ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const page = parseInt(searchParams.get("page"));
    const ps = parseInt(searchParams.get("pageSize"));
    if (page && ps) {
      // Paginated mode: lean projection + sort + server totals/counts. Returns
      // `{ rows, total, counts }` so the table + stat cards don't need the set.
      const whereCount = params.length;
      const sort = searchParams.get("sort");
      const sortDir = (searchParams.get("sortDir") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
      const orderBy = sort && MT_SORTABLE[sort]
        ? ` ORDER BY ${MT_SORTABLE[sort]} ${sortDir}`
        : " ORDER BY vm.maintenance_date DESC";

      const [rowsRes, totalRes, countsRes] = await Promise.all([
        query(
          mtLeanListSQL(isMechanic ? MT_MECHANIC_SELECT : MT_LIST_SELECT, where, orderBy, ` LIMIT $${idx++} OFFSET $${idx++}`),
          [...params, ps, (page - 1) * ps]
        ),
        query(`SELECT count(*) AS total ${MT_FROM} ${where}`, params.slice(0, whereCount)),
        // Mechanic stat cards are scoped by the same assignment; staff totals stay global.
        isMechanic
          ? query(`${MT_COUNTS_SQL} AND vm.assigned_mechanic_id = $1`, [session.user.employeeId])
          : query(MT_COUNTS_SQL),
      ]);

      const c = countsRes.rows[0] || {};
      return ok({
        rows: maintenanceRowsWithCalendarDates(rowsRes.rows),
        total: Number(totalRes.rows[0]?.total) || 0,
        page,
        pageSize: ps,
        counts: {
          total: Number(c.total) || 0,
          scheduled: Number(c.scheduled) || 0,
          overdue: Number(c.overdue) || 0,
          inProgress: Number(c.inProgress) || 0,
          totalCost: Number(c.total_cost) || 0,
        },
      });
    }

    // Non-paginated: mechanics take the same lean branch (never the fat
    // select below); staff callers keep the full array projection plus the
    // display-only name of the recorded repair performer.
    if (isMechanic) {
      const { rows } = await query(
        mtLeanListSQL(MT_MECHANIC_SELECT, where, " ORDER BY vm.maintenance_date DESC", ""),
        params
      );
      return ok(maintenanceRowsWithCalendarDates(rows));
    }

    // Non-paginated: full array (other callers).
    const { rows } = await query(
      `SELECT vm.*, row_to_json(v.*) as vehicles,
              NULLIF(trim(concat_ws(' ', repairer.first_name, repairer.last_name)), '') AS repair_completed_by_name
       ${MT_FROM} ${MT_REPAIRER_JOIN} ${where} ORDER BY vm.maintenance_date DESC`,
      params
    );
    return ok(maintenanceRowsWithCalendarDates(rows));
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "maintenance", "create");
    const body = await parseBody(req);

    const errors = validateBody(body, maintenanceWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    // P1 Fix: Force all new records to be Scheduled.
    // Completed status can only be achieved via the PUT state-machine.
    body.status = "Scheduled";
    delete body.completed_by;
    delete body.completed_at;
    delete body.completed_date;

    // Provenance: the server stamps the filing actor. A client-supplied
    // created_by is never trusted (spoof-proof by deletion, not by hoping the
    // allowlist drops it) — the audit row already records the actor, and the
    // work order row now carries it too.
    const fuelDiagnostic = isFuelDiagnosticPayload(body);
    delete body.created_by;

    // P0 mechanic integration: only staff may assign at creation. The PUT
    // whitelist already strips assigned_mechanic_id for mechanics; the POST
    // allowlist below would otherwise let a non-staff caller set it. Strip
    // first so the column is unreachable, whatever the allowlist carries.
    const ASSIGN_STAFF_ROLES = new Set(["super_admin", "admin", "fleet_manager"]);
    if (!ASSIGN_STAFF_ROLES.has(normalizeRoleName(session?.user?.role))) {
      delete body.assigned_mechanic_id;
    }

    // A supplied assignee must be a real, active mechanic — not merely a
    // well-formed id. Checked up front (outside the insert transaction: a
    // standalone read, no write to roll back) so a bad id fails as 400
    // before any INSERT. An empty string is "no selection" from the staff
    // select, not an assignment — drop it so the column stays untouched.
    let assigningMechanic = false;
    if (body.assigned_mechanic_id !== undefined && body.assigned_mechanic_id !== null && body.assigned_mechanic_id !== "") {
      const { rows: mechRows } = await query(
        `SELECT employee_id FROM employees
          WHERE employee_id = $1 AND role_id = $2 AND deleted_at IS NULL AND status = 'Active'
          LIMIT 1`,
        [Number(body.assigned_mechanic_id), ROLE_IDS.mechanic]
      );
      if (!mechRows[0]) return err("Assigned mechanic is not a valid active mechanic.", 400);
      body.assigned_mechanic_id = mechRows[0].employee_id;
      assigningMechanic = true;
    } else {
      delete body.assigned_mechanic_id;
    }

    // Build from the allowlist, not from Object.keys(body). Previously any
    // unknown body key was interpolated straight into the column list.
    // Deduplicated by column: an alias and its column name both map to one
    // column, and naming it twice makes Postgres reject the whole INSERT.
    // First declared spelling wins, so aliases take precedence.
    const columns = [];
    const values = [];
    const seen = new Set();
    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      if (body[field] === undefined) continue;
      if (seen.has(column)) continue;
      seen.add(column);
      columns.push(column);
      values.push(body[field] === "" ? null : body[field]);
    }
    if (columns.length === 0) return err("No writable fields were provided", 400);

    // Server-stamped after the allowlist build so no client key can collide
    // with it: created_by is not in FIELD_TO_COLUMN and never comes from body.
    columns.push("created_by");
    values.push(session.user.employeeId ?? null);

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    // Assigning at creation stamps the assignment moment, mirroring the PUT
    // rule (staff assigning assigned_mechanic_id get assigned_at = NOW()).
    const insertSql = assigningMechanic
      ? `INSERT INTO vehiclemaintenance (${columns.join(", ")}, assigned_at) VALUES (${placeholders}, CURRENT_TIMESTAMP) RETURNING *`
      : `INSERT INTO vehiclemaintenance (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`;
    const result = await withTransaction(async (tx) => {
      const review = isReviewedPlanRequest(body) ? await reviewPlanWorkOrder(tx, session.user, body) : null;
      if (review?.existing) return { row: review.existing, created: false };
      if (!review) await tx.query(
        "SELECT vehicle_id FROM vehicles WHERE vehicle_id = $1 FOR UPDATE", [Number(body.vehicle_id)]
      );
      const linkedColumns = review ? [...columns, "service_plan_id", "service_plan_version"] : columns;
      const linkedValues = review ? [...values, review.plan.plan_id, review.plan.version] : values;
      if (review) linkedValues[columns.indexOf("maintenance_type")] = review.plan.service_code === "routine" ? "Routine" : "Preventive";
      const linkedSql = review
        ? `INSERT INTO vehiclemaintenance (${linkedColumns.join(", ")}${assigningMechanic ? ", assigned_at" : ""}) VALUES (${linkedValues.map((_,i) => `$${i+1}`).join(", ")}${assigningMechanic ? ", CURRENT_TIMESTAMP" : ""}) RETURNING *`
        : insertSql;
      const { rows } = await tx.query(linkedSql, linkedValues);
      if (review?.reviewedService) await appendMaintenanceSnapshot(tx,{event:"reviewed_schedule",order:rows[0],actorId:session.user.employeeId,forecast:review.reviewedService,inputs:{assessed_at:review.reviewedService.assessed_at,service_plan_version:review.plan.version,mileage:review.reviewedService.mileage,evidence:review.reviewedService.evidence,last_service_date:review.reviewedService.last_service_date,last_service_mileage:review.reviewedService.last_service_mileage,interval_days:review.reviewedService.interval_days,interval_km:review.reviewedService.interval_km}});
      if (rows[0]?.vehicle_id) await syncVehicleStatus(rows[0].vehicle_id, tx);
      await writeAuditRequired(tx, req, session, {
        action: "maintenance_created",
        resource: "vehiclemaintenance",
        resourceId: rows[0]?.maintenance_id,
        newValues: {
          vehicle_id: rows[0]?.vehicle_id,
          status: rows[0]?.status,
          changed_fields: linkedColumns,
          ...(review ? { service_plan_id: review.plan.plan_id, service_plan_version: review.plan.version, service_code: review.plan.service_code } : {}),
          source_incident_id: rows[0]?.source_incident_id,
          ...(assigningMechanic ? { assigned_mechanic_id: rows[0]?.assigned_mechanic_id } : {}),
        },
      });
      return { row: rows[0], created: true, reviewedService: review?.reviewedService ?? null };
    });
    const { row, created } = result;
    if (created && assigningMechanic && row?.maintenance_id) {
      try {
        const plate = (await query("SELECT plate_number FROM vehicles WHERE vehicle_id = $1", [row.vehicle_id])).rows[0]?.plate_number ?? null;
        // One ping, not two: an urgent assignment pages as the Alert only —
        // the plain Assigned note would be a second push for the same event.
        const isUrgent = ["High", "Emergency"].includes(row.priority);
        if (!isUrgent) {
          await fanoutMaintenanceNotification({ employeeIds: [row.assigned_mechanic_id], copy: maintenanceAssigned({ plate }), referenceType: "mechanic_maintenance", referenceId: row.maintenance_id });
        } else {
          const staffIds = (await resolveNotificationRecipients({ roles: notificationRolesFor("incidents", "route_to_maintenance") })).filter((id) => Number(id) !== Number(row.assigned_mechanic_id));
          await fanoutMaintenanceNotification({ employeeIds: [row.assigned_mechanic_id], copy: maintenanceUrgent({ plate }), referenceType: "mechanic_maintenance", referenceId: row.maintenance_id, type: "Alert" });
          await fanoutMaintenanceNotification({ employeeIds: staffIds, copy: maintenanceUrgent({ plate }), referenceType: "maintenance", referenceId: row.maintenance_id, type: "Alert" });
        }
      } catch (e) {
        await writeAppError({ source: "server", route: "POST /api/vehicle-maintenance", message: `Maintenance fan-out failed for work order #${row.maintenance_id}: ${e?.message || e}`, stack: e?.stack ?? null, statusCode: 500, employeeId: session?.user?.employeeId ?? null });
      }
    }
    // Fuel diagnostic filings page the maintenance queue through the same
    // audience the incident/inspection paths page (notificationRolesFor
    // incidents/route_to_maintenance) with a fuel-specific title and the same
    // INSERT … WHERE NOT EXISTS dedupe. Best-effort only: a notify failure
    // lands in app_errors and never fails the create. Ordinary (non-fuel)
    // creates are untouched — the marker predicate is what arms this.
    if (created && fuelDiagnostic && row?.maintenance_id) {
      try {
        const { notifyFuelDiagnosticTeam } = await import("@/lib/fuel/maintenance");
        const plate = (await query(
          `SELECT plate_number FROM vehicles WHERE vehicle_id = $1`,
          [row.vehicle_id]
        )).rows[0]?.plate_number ?? null;
        await notifyFuelDiagnosticTeam(row, { plate });
      } catch (e) {
        await writeAppError({
          source: "server",
          route: "POST /api/vehicle-maintenance",
          message: `Fuel diagnostic notify failed for work order #${row?.maintenance_id}: ${e?.message || e}`,
          stack: e?.stack ?? null,
          statusCode: 500,
          employeeId: session?.user?.employeeId ?? null,
        });
      }
    }
    return ok(row, created ? 201 : 200);
  } catch (e) { return handleError(e); }
}
