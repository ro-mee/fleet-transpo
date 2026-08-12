import { getAdminClient } from "@/lib/db";

function isBeforeToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !Number.isNaN(d.getTime()) && d.getTime() < today.getTime();
}

// Last instant of the current local day — the horizon past which a booking is
// too far off to hold the vehicle. Local, not UTC: the fleet is read in local
// days, and `toISOString()` on a local midnight lands on the wrong date east
// of Greenwich.
function endOfTodayIso() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
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
    .in("trip_status", ["Trip Started", "En Route", "Arrived", "In Progress"])
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

  // A booking only holds the vehicle once it is close enough to matter. Both
  // checks below used to fire on ANY open row with no time bound, so a vehicle
  // booked for next Friday read as `Reserved` every day until then, and every
  // availability search that trusted the status flag dropped it from all other
  // dates. The horizon is the end of the current local day: today's bookings
  // hold the vehicle, later ones leave it Available.
  //
  // There is deliberately no lower bound. An open dispatch whose departure has
  // already passed still holds the vehicle — it is either out on the road or
  // the row is stale, and neither state makes the vehicle grabbable. Releasing
  // it is trip completion's job, not a status sweep's. A row with no departure
  // recorded holds it too, for the same reason: unknown is not "free".
  const horizon = endOfTodayIso();

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("dispatch_id")
    .eq("vehicle_id", vehicleId)
    .in("status", ["Scheduled", "In Progress"])
    .or(`scheduled_departure.is.null,scheduled_departure.lte.${horizon}`)
    .is("deleted_at", null)
    .limit(1);
  if (dispatch?.length) {
    await supabase.from("vehicles").update({ vehicle_status: "Reserved" }).eq("vehicle_id", vehicleId);
    return;
  }

  const { data: reservation } = await supabase
    .from("transportation_requests")
    .select("request_id")
    .eq("vehicle_id", vehicleId)
    .in("fleet_status", ["Approved", "Scheduled", "Assigned"])
    .is("deleted_at", null)
    .limit(1);
  if (reservation?.length) {
    await supabase.from("vehicles").update({ vehicle_status: "Reserved" }).eq("vehicle_id", vehicleId);
    return;
  }

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

  const { data: driver } = await supabase
    .from("drivers")
    .select("driver_status, license_expiry")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (!driver) return;
  if (driver.driver_status === "On Leave") return;

  const { data: trip } = await supabase
    .from("trips")
    .select("trip_id")
    .eq("driver_id", driverId)
    .in("trip_status", ["Trip Started", "En Route", "Arrived", "In Progress"])
    .is("deleted_at", null)
    .limit(1);
  if (trip?.length) {
    await supabase.from("drivers").update({ driver_status: "On Trip" }).eq("driver_id", driverId);
    return;
  }

  if (isBeforeToday(driver.license_expiry)) {
    await supabase.from("drivers").update({ driver_status: "Suspended" }).eq("driver_id", driverId);
    return;
  }

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("dispatch_id")
    .eq("driver_id", driverId)
    .in("status", ["Scheduled", "In Progress"])
    .is("deleted_at", null)
    .limit(1);
  if (dispatch?.length) {
    await supabase.from("drivers").update({ driver_status: "On Trip" }).eq("driver_id", driverId);
    return;
  }

  await supabase.from("drivers").update({ driver_status: "Available" }).eq("driver_id", driverId);
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
