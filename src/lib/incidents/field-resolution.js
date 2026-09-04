import {
  buildFieldResolutionNarrative,
  fieldResolutionGuards,
  shouldKeepVehicleGrounded,
} from "@/lib/incidents/resolution";

// Shared transactional core for field resolution — the reporting driver or the
// assigned fleet responder closing an incident from the mobile app. Both
// endpoints (POST /api/driver/incidents/[id]/resolve and
// POST /api/driver/responder/resolve) call this so the write path — guards,
// status flip, auto narrative, comment, vehicle grounding — exists exactly
// once. Notification side effects stay in the routes (best-effort, after
// commit), same split as responder-tracking.js.

/**
 * Resolve an incident on a field party's confirmation, inside the caller's
 * transaction.
 *
 * @param {import("pg").PoolClient} tx active transaction client
 * @param {{
 *   incidentId: number|string,
 *   confirmer: { employeeId: number|null, role: "driver"|"responder", name: string },
 *   note?: string|null,
 *   assertDriverId?: number|null,
 *   assertResponderDriverId?: number|null,
 * }} args
 * @returns {Promise<
 *   | { guard: "not-found"|"not-open"|"not-acknowledged"|"grounding"|"not-arrived" }
 *   | { row: object, current: object, keepVehicleGrounded: boolean, narrative: string }
 * >}
 */
export async function resolveFromField(tx, args) {
  const { incidentId, confirmer, note = null, assertDriverId = null, assertResponderDriverId = null } = args;

  const { rows } = await tx.query(
    `SELECT i.incident_id, i.status, i.acknowledged_at, i.grounding_status,
            i.response_status, i.vehicle_id, i.actions_taken,
            i.requires_vehicle_maintenance, i.maintenance_id,
            i.driver_id, i.responder_driver_id,
            m.status AS maintenance_status,
            de.employee_id AS reporter_employee_id,
            de.first_name AS reporter_first_name, de.last_name AS reporter_last_name,
            re.employee_id AS responder_employee_id,
            re.first_name AS responder_first_name, re.last_name AS responder_last_name
       FROM driverincidents i
       LEFT JOIN drivers d ON d.driver_id = i.driver_id
       LEFT JOIN employees de ON de.employee_id = d.employee_id
       LEFT JOIN drivers rd ON rd.driver_id = i.responder_driver_id
       LEFT JOIN employees re ON re.employee_id = rd.employee_id
       LEFT JOIN vehiclemaintenance m
         ON m.maintenance_id = i.maintenance_id AND m.deleted_at IS NULL
      WHERE i.incident_id = $1 AND i.deleted_at IS NULL
      FOR UPDATE OF i`,
    [incidentId]
  );
  const current = rows[0];
  if (!current) return { guard: "not-found" };
  // Ownership is authoritative against the locked row, not a pre-check.
  if (assertDriverId != null && current.driver_id !== assertDriverId) return { guard: "not-found" };
  if (assertResponderDriverId != null && current.responder_driver_id !== assertResponderDriverId) {
    return { guard: "not-found" };
  }

  const guard = fieldResolutionGuards({ currentRow: current, confirmerRole: confirmer.role });
  if (!guard.ok) return { guard: guard.reason };

  const narrative = buildFieldResolutionNarrative({ role: confirmer.role, name: confirmer.name, note });
  const { rows: updated } = await tx.query(
    `UPDATE driverincidents
        SET status = 'Resolved',
            resolved_at = NOW(),
            resolved_by = $2::int,
            actions_taken = $3,
            driver_confirmed_at = CASE WHEN $4::varchar = 'driver' THEN NOW() ELSE driver_confirmed_at END,
            updated_at = NOW()
      WHERE incident_id = $1 AND deleted_at IS NULL
      RETURNING incident_id, status, resolved_at, resolved_by,
                actions_taken, driver_confirmed_at`,
    [incidentId, confirmer.employeeId ?? null, narrative, confirmer.role]
  );

  await tx.query(
    `INSERT INTO incident_comments (incident_id, user_id, action_type, comment_text)
     VALUES ($1, $2, 'RESOLVED', $3)`,
    [incidentId, confirmer.employeeId ?? null, narrative]
  );

  // Resolving never releases a vehicle whose required work order is still
  // open — the same gate as the staff resolve.
  const keepVehicleGrounded = shouldKeepVehicleGrounded({
    status: "Resolved",
    requiresVehicleMaintenance: current.requires_vehicle_maintenance,
    maintenanceStatus: current.maintenance_status,
  });
  if (keepVehicleGrounded && current.vehicle_id) {
    await tx.query(
      `UPDATE vehicles
          SET vehicle_status = 'Under Maintenance', updated_at = NOW()
        WHERE vehicle_id = $1
          AND deleted_at IS NULL
          AND vehicle_status <> 'Decommissioned'`,
      [current.vehicle_id]
    );
  }

  return { row: updated[0], current, keepVehicleGrounded, narrative };
}
