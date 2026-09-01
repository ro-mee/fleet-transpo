import { query, withTransaction } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { toCalendarDay } from "@/lib/dates";
import { AuthError, requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";

const monthStart = (value) => {
  const month = value || toCalendarDay(new Date()).slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : null;
};

const USAGE_CTES = `
  WITH consumed AS (
    SELECT vehicle_id, COALESCE(SUM(liters), 0)::numeric AS liters
      FROM fuelrecords
     WHERE status = 'Approved' AND deleted_at IS NULL
       AND fuel_date >= $1::date AND fuel_date < ($1::date + INTERVAL '1 month')
     GROUP BY vehicle_id
  ), committed AS (
    SELECT r.vehicle_id, COALESCE(SUM(r.approved_liters), 0)::numeric AS liters
      FROM fuelrequests r
      LEFT JOIN fuelrecords f ON f.fuel_request_id = r.fuel_request_id AND f.deleted_at IS NULL
     WHERE r.allocation_month = $1::date
       AND (r.status = 'Approved' OR (r.status = 'Fulfilled' AND COALESCE(f.status, 'Pending') <> 'Approved'))
     GROUP BY r.vehicle_id
  )`;

export async function GET(req) {
  try {
    await requirePermission(req, "fuelallocations", "read");
    const month = monthStart(new URL(req.url).searchParams.get("month"));
    if (!month) return err("month must use YYYY-MM", 400);
    const { rows } = await query(
      `${USAGE_CTES}
         SELECT v.vehicle_id, v.plate_number, v.vehicle_name, v.fuel_level,
                v.tank_capacity_l, v.fuel_efficiency_kmpl,
                a.allocation_id, a.allocation_month, a.allocated_liters,
                COALESCE(c.liters, 0) AS consumed_liters,
                COALESCE(m.liters, 0) AS committed_liters,
                GREATEST(COALESCE(a.allocated_liters, 0) - COALESCE(c.liters, 0) - COALESCE(m.liters, 0), 0) AS remaining_liters
           FROM vehicles v
           LEFT JOIN fuelallocations a ON a.vehicle_id = v.vehicle_id AND a.allocation_month = $1::date
           LEFT JOIN consumed c ON c.vehicle_id = v.vehicle_id
           LEFT JOIN committed m ON m.vehicle_id = v.vehicle_id
          WHERE v.deleted_at IS NULL
          ORDER BY (a.allocation_id IS NULL) DESC, v.plate_number`,
      [month]
    );
    return ok({ month, rows });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requirePermission(req, "fuelallocations", "update");
    const body = await parseBody(req);
    const vehicleId = Number(body.vehicle_id);
    const allocatedLiters = Number(body.allocated_liters);
    const tankCapacity = Number(body.tank_capacity_l);
    const efficiency = Number(body.fuel_efficiency_kmpl);
    const month = monthStart(body.month);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return err("vehicle_id is required", 400);
    if (!month) return err("month must use YYYY-MM", 400);
    if (!Number.isFinite(allocatedLiters) || allocatedLiters <= 0 || allocatedLiters > 100000) return err("allocated_liters must be between 0 and 100000", 400);
    if (!Number.isFinite(tankCapacity) || tankCapacity <= 0 || tankCapacity > 1000) return err("tank_capacity_l must be between 0 and 1000", 400);
    if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 100) return err("fuel_efficiency_kmpl must be between 0 and 100", 400);

    const saved = await withTransaction(async (tx) => {
      const { rows: vehicles } = await tx.query(
        `SELECT * FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [vehicleId]
      );
      if (!vehicles[0]) throw new AuthError("Vehicle not found", 404);
      const { rows: usage } = await tx.query(
        `${USAGE_CTES}
         SELECT COALESCE(c.liters, 0) + COALESCE(m.liters, 0) AS used_liters
           FROM (SELECT $2::int AS vehicle_id) v
           LEFT JOIN consumed c ON c.vehicle_id = v.vehicle_id
           LEFT JOIN committed m ON m.vehicle_id = v.vehicle_id`,
        [month, vehicleId]
      );
      if (allocatedLiters < Number(usage[0].used_liters)) {
        throw new AuthError(`Monthly allocation cannot be below the ${Number(usage[0].used_liters).toFixed(2)} L already consumed or committed`, 400);
      }

      await tx.query(
        `UPDATE vehicles
            SET tank_capacity_l = $2, fuel_efficiency_kmpl = $3, updated_at = NOW(), updated_by = $4
          WHERE vehicle_id = $1`,
        [vehicleId, tankCapacity, efficiency, session.user.employeeId]
      );
      const { rows } = await tx.query(
        `INSERT INTO fuelallocations
           (vehicle_id, allocation_month, allocated_liters, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (vehicle_id, allocation_month)
         DO UPDATE SET allocated_liters = EXCLUDED.allocated_liters,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = NOW()
         RETURNING *`,
        [vehicleId, month, allocatedLiters, session.user.employeeId]
      );
      return { oldVehicle: vehicles[0], allocation: rows[0] };
    });

    await writeAudit(req, session, {
      action: "update",
      resource: "fuelallocations",
      resourceId: saved.allocation.allocation_id,
      oldValues: {
        tank_capacity_l: saved.oldVehicle.tank_capacity_l,
        fuel_efficiency_kmpl: saved.oldVehicle.fuel_efficiency_kmpl,
      },
      newValues: saved.allocation,
    });
    return ok(saved.allocation);
  } catch (e) {
    return handleError(e);
  }
}
