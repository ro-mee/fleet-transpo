import { getAdminClient } from "@/lib/db";

export async function syncVehicleStatus(vehicleId) {
  const supabase = getAdminClient();

  const { data: maintenance } = await supabase
    .from("vehiclemaintenance")
    .select("maintenance_id")
    .eq("vehicle_id", vehicleId)
    .in("status", ["Scheduled", "In Progress"])
    .is("deleted_at", null)
    .limit(1);
  if (maintenance?.length) {
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

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("dispatch_id")
    .eq("vehicle_id", vehicleId)
    .in("status", ["Scheduled", "In Progress"])
    .is("deleted_at", null)
    .limit(1);
  if (dispatch?.length) {
    await supabase.from("vehicles").update({ vehicle_status: "Reserved" }).eq("vehicle_id", vehicleId);
    return;
  }

  const { data: reservation } = await supabase
    .from("vehiclereservations")
    .select("reservation_id")
    .eq("vehicle_id", vehicleId)
    .in("status", ["Approved", "Dispatched"])
    .is("deleted_at", null)
    .limit(1);
  if (reservation?.length) {
    await supabase.from("vehicles").update({ vehicle_status: "Reserved" }).eq("vehicle_id", vehicleId);
    return;
  }

  await supabase.from("vehicles").update({ vehicle_status: "Available" }).eq("vehicle_id", vehicleId);
}

export async function syncDriverStatus(driverId) {
  const supabase = getAdminClient();

  const { data: driver } = await supabase
    .from("drivers")
    .select("driver_status")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (!driver) return;
  if (driver.driver_status === "On Leave" || driver.driver_status === "Suspended") return;

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

export async function syncReservationStatus(reservationId) {
  if (!reservationId) return;
  const supabase = getAdminClient();

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("dispatch_id, status")
    .eq("reservation_id", reservationId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!dispatch) return;

  if (dispatch.status === "Completed") {
    await supabase.from("vehiclereservations").update({ status: "Completed" }).eq("reservation_id", reservationId);
    return;
  }

  const { data: trip } = await supabase
    .from("trips")
    .select("trip_id")
    .eq("dispatch_id", dispatch.dispatch_id)
    .in("trip_status", ["Trip Started", "En Route", "Arrived", "In Progress"])
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (trip) {
    await supabase.from("vehiclereservations").update({ status: "Dispatched" }).eq("reservation_id", reservationId);
    return;
  }

  if (dispatch.status === "Scheduled") {
    await supabase.from("vehiclereservations").update({ status: "Dispatched" }).eq("reservation_id", reservationId);
  }
}

export async function syncDispatchReservation(dispatchId) {
  if (!dispatchId) return;
  const supabase = getAdminClient();

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("reservation_id")
    .eq("dispatch_id", dispatchId)
    .maybeSingle();
  if (dispatch?.reservation_id) await syncReservationStatus(dispatch.reservation_id);
}

export async function ensureTripForDispatch(dispatchId) {
  if (!dispatchId) return;
  const supabase = getAdminClient();

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("dispatch_id, vehicle_id, driver_id, reservation_id, route_id")
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
