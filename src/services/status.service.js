import { getAdminClient } from "@/lib/db";
import { query } from "@/lib/db";
import { suspensionAction } from "@/lib/drivers/compliance";
import { DRIVER_STATUS, DRIVER_SUSPENSION_REASON } from "@/lib/constants";
import { rolesFor } from "@/lib/auth/permissions";

function isBeforeToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !Number.isNaN(d.getTime()) && d.getTime() < today.getTime();
}


export async function syncVehicleStatus(vehicleId) {  const supabase = getAdminClient();

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("vehicle_status, registration_expiry")
    .eq("vehicle_id", vehicleId)
    .maybeSingle();
  if (!vehicle || vehicle.vehicle_status === "Decommissioned") return;

  const { data: maintenance } = await supabase
    .from("vehiclemaintenance")
    .select("maintenance_id, status, maintenance_date")
    .eq("vehicle_id", vehicleId)
    .in("status", ["Scheduled", "In Progress"])
    .is("deleted_at", null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const hasActiveMaintenance = (maintenance || []).some((m) => {
    if (m.status === "In Progress") return true;
    const d = new Date(`${String(m.maintenance_date).slice(0, 10)}T00:00:00`);
    return !Number.isNaN(d.getTime()) && d.getTime() <= today.getTime();
  });
  if (hasActiveMaintenance) {
    await supabase.from("vehicles").update({ vehicle_status: "Under Maintenance" }).eq("vehicle_id", vehicleId);
    return;
  }

  const { data: trip } = await supabase
    .from("trips")
    .select("trip_id")
    .eq("vehicle_id", vehicleId)
    .in("trip_status", ["Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"])
    .is("deleted_at", null)
    .limit(1);
  if (trip?.length) {
    await supabase.from("vehicles").update({ vehicle_status: "In Use" }).eq("vehicle_id", vehicleId);
    return;
  }

  if (isBeforeToday(vehicle?.registration_expiry)) {
    await supabase.from("vehicles").update({ vehicle_status: "Registration Expired" }).eq("vehicle_id", vehicleId);
    return;
  }

  // NOTE: there is deliberately NO "Reserved" state. A coarse whole-day flag
  // cannot express "busy 1am–2am, free 3am" — it pinned a car `Reserved` for a
  // single booking and made every strict-`Available` picker hide it for all
  // other times and days. Time-slot availability is answered precisely by the
  // windowed searches (vehicles/available slot overlap, findDispatchConflicts,
  // findReservationConflicts), so an open dispatch/booking on the row below
  // never flips the flag. A vehicle is Available unless it is conditionally
  // grounded (maintenance above, live trip above, expired registration above).
  await supabase.from("vehicles").update({ vehicle_status: "Available" }).eq("vehicle_id", vehicleId);
}

export async function syncAllVehicleStatuses() {
  const supabase = getAdminClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const { data: dueMaintenance } = await supabase
    .from("vehiclemaintenance")
    .select("vehicle_id")
    .eq("status", "Scheduled")
    .lte("maintenance_date", todayStr)
    .is("deleted_at", null);

  const { data: underMaintenance } = await supabase
    .from("vehicles")
    .select("vehicle_id")
    .eq("vehicle_status", "Under Maintenance")
    .is("deleted_at", null);

  const { data: expiredRegistration } = await supabase
    .from("vehicles")
    .select("vehicle_id")
    .lt("registration_expiry", todayStr)
    .is("deleted_at", null);

  const { data: allVehicles } = await supabase
    .from("vehicles")
    .select("vehicle_id")
    .is("deleted_at", null);

  const ids = new Set();
  (dueMaintenance || []).forEach((r) => {
    if (r.vehicle_id) ids.add(r.vehicle_id);
  });
  (underMaintenance || []).forEach((r) => {
    if (r.vehicle_id) ids.add(r.vehicle_id);
  });
  (expiredRegistration || []).forEach((r) => {
    if (r.vehicle_id) ids.add(r.vehicle_id);
  });
  (allVehicles || []).forEach((r) => {
    if (r.vehicle_id) ids.add(r.vehicle_id);
  });

  let synced = 0;
  for (const id of ids) {
    await syncVehicleStatus(id);
    synced += 1;
  }
  return { synced };
}

export async function syncAllDriverStatuses() {
  const supabase = getAdminClient();
  const { data: drivers } = await supabase
    .from("drivers")
    .select("driver_id")
    .is("deleted_at", null);

  let synced = 0;
  for (const d of drivers || []) {
    if (!d.driver_id) continue;
    await syncDriverStatus(d.driver_id);
    synced += 1;
  }
  return { synced };
}

export async function syncComplianceNotifications() {
  const supabase = getAdminClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const { data: roles } = await supabase
    .from("roles")
    .select("role_id")
    .in("role_name", ["fleet_manager", "admin"]);
  const roleIds = (roles || []).map((r) => r.role_id);
  if (roleIds.length === 0) return { created: 0 };

  const { data: staff } = await supabase
    .from("employees")
    .select("employee_id")
    .in("role_id", roleIds);
  const staffIds = (staff || []).map((e) => e.employee_id);
  if (staffIds.length === 0) return { created: 0 };

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("vehicle_id, plate_number, registration_expiry")
    .lt("registration_expiry", todayStr)
    .is("deleted_at", null);

  const { data: existingVehicleNotes } = await supabase
    .from("notifications")
    .select("reference_id")
    .eq("reference_type", "vehicle")
    .eq("title", "Registration Overdue");
  const notedVehicleIds = new Set((existingVehicleNotes || []).map((n) => n.reference_id));

  let created = 0;
  for (const v of vehicles || []) {
    if (notedVehicleIds.has(v.vehicle_id)) continue;
    const rows = staffIds.map((employee_id) => ({
      employee_id,
      title: "Registration Overdue",
      message: `Vehicle ${v.plate_number || "#" + v.vehicle_id} LTO registration expired on ${v.registration_expiry}. Renew immediately.`,
      type: "Warning",
      reference_type: "vehicle",
      reference_id: v.vehicle_id,
    }));
    if (rows.length) {
      const { error } = await supabase.from("notifications").insert(rows);
      if (!error) created += rows.length;
    }
  }

  const { data: drivers } = await supabase
    .from("drivers")
    .select("driver_id, license_expiry")
    .lt("license_expiry", todayStr)
    .is("deleted_at", null);

  const { data: existingLicenseNotes } = await supabase
    .from("notifications")
    .select("reference_id")
    .eq("reference_type", "driver")
    .eq("title", "License Expired");
  const notedDriverIds = new Set((existingLicenseNotes || []).map((n) => n.reference_id));

  for (const d of drivers || []) {
    if (notedDriverIds.has(d.driver_id)) continue;
    const rows = staffIds.map((employee_id) => ({
      employee_id,
      title: "License Expired",
      message: `Driver license for driver #${d.driver_id} expired on ${d.license_expiry}.`,
      type: "Warning",
      reference_type: "driver",
      reference_id: d.driver_id,
    }));
    if (rows.length) {
      const { error } = await supabase.from("notifications").insert(rows);
      if (!error) created += rows.length;
    }
  }

  return { created };
}

export async function syncDriverStatus(driverId) {
  const supabase = getAdminClient();

  // Driver availability is separate from trip activity. driver_status is a
  // human-set availability flag (Available / Off Duty / On Leave / Suspended);
  // being mid-trip is captured by the windowed conflict checks, not by flipping
  // this column to "On Trip".
  //
  // The only automatic write is license compliance, decided by the pure helper
  // in src/lib/drivers/compliance.js: an expired license suspends — stamped
  // with suspension_reason so it can later be auto-reinstated — and ONLY a
  // 'license_expired' suspension is ever auto-restored. Manual/legacy
  // suspensions (any other reason or NULL) are never touched here.
  // On Leave always wins.
  const { data: driver } = await supabase
    .from("drivers")
    .select("driver_status, license_expiry, suspension_reason")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (!driver) return;

  const decision = suspensionAction({
    driverStatus: driver.driver_status,
    suspensionReason: driver.suspension_reason,
    licenseExpiry: driver.license_expiry,
  });

  if (decision.action === "suspend") {
    await supabase
      .from("drivers")
      .update({
        driver_status: DRIVER_STATUS.SUSPENDED,
        suspension_reason: decision.reason,
      })
      .eq("driver_id", driverId);

    // The suspension used to be silent — dispatchers found out when a booking
    // failed. Tell the people who can act on it. Best-effort.
    try {
      const { rows: info } = await query(
        `SELECT e.first_name || ' ' || e.last_name AS name, d.license_expiry
           FROM drivers d JOIN employees e ON e.employee_id = d.employee_id
          WHERE d.driver_id = $1`,
        [driverId]
      );
      const name = info.rows[0]?.name || `Driver #${driverId}`;
      const expiry = info.rows[0]?.license_expiry || "unknown date";
      const { rows: staff } = await query(
        `SELECT employee_id FROM employees
          WHERE role_id IN (SELECT role_id FROM roles WHERE role_name = ANY($1))
            AND deleted_at IS NULL`,
        [rolesFor("drivers", "update")]
      );
      if (staff.length) {
        await supabase.from("notifications").insert(
          staff.map((s) => ({
            employee_id: s.employee_id,
            title: "Driver Auto-Suspended",
            message: `${name} was automatically suspended — license expired ${expiry}. Reinstate from their profile after renewal.`,
            type: "Warning",
            reference_type: "driver",
            reference_id: driverId,
          }))
        );
        const { sendPush } = await import("@/services/push.service");
        await sendPush({
          employeeIds: staff.map((s) => s.employee_id),
          title: "Driver Auto-Suspended",
          body: `${name} suspended — license expired ${expiry}.`,
          data: { reference_type: "driver", reference_id: driverId },
        });
      }
    } catch (e) {
      console.warn("driver suspend notification failed:", e?.message || e);
    }
  }

  // Safety-net restore for a compliance suspension whose license became valid
  // again through some path other than PUT /api/drivers/[id] (which performs
  // its own reinstatement with audit + notification). Silent by design to
  // avoid duplicate notices; manual/legacy reasons never reach this branch.
  if (decision.action === "restore") {
    await supabase
      .from("drivers")
      .update({ driver_status: DRIVER_STATUS.AVAILABLE, suspension_reason: null })
      .eq("driver_id", driverId);
  }

  return decision;
}


export async function ensureTripForDispatch(dispatchId) {
  if (!dispatchId) return;
  const supabase = getAdminClient();

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("dispatch_id, vehicle_id, driver_id, route_id")
    .eq("dispatch_id", dispatchId)
    .maybeSingle();
  if (!dispatch) return;

  if (!dispatch.vehicle_id || !dispatch.driver_id) return;

  const { data: existing } = await supabase
    .from("trips")
    .select("trip_id")
    .eq("dispatch_id", dispatchId)
    .is("deleted_at", null)
    .limit(1);
  if (existing?.length) return;

  await supabase.from("trips").insert({
    vehicle_id: dispatch.vehicle_id,
    driver_id: dispatch.driver_id,
    dispatch_id: dispatch.dispatch_id,
    route_id: dispatch.route_id,
    trip_status: "Assigned",
  });
}
