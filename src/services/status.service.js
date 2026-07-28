import { createClient } from "@/lib/supabase/client";

/**
 * Recompute a vehicle's status based on current activity across all modules.
 *
 * Priority (highest to lowest):
 *   1. Under Maintenance — active maintenance record exists
 *   2. Dispatched       — active dispatch or trip in progress
 *   3. Reserved         — approved/pending reservation exists
 *   4. Available        — nothing active
 */
export async function syncVehicleStatus(vehicleId) {
  const supabase = createClient();

  // 1. Active maintenance (Scheduled or In Progress)
  const { data: maintenance } = await supabase
    .from("vehiclemaintenance")
    .select("maintenance_id")
    .eq("vehicle_id", vehicleId)
    .in("status", ["Scheduled", "In Progress"])
    .is("deleted_at", null)
    .maybeSingle();

  if (maintenance) {
    await supabase
      .from("vehicles")
      .update({ vehicle_status: "Under Maintenance" })
      .eq("vehicle_id", vehicleId);
    return;
  }

  // 2. Active dispatch (Dispatched, In Progress, Driver Accepted, En Route)
  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("dispatch_id")
    .eq("vehicle_id", vehicleId)
    .in("status", ["Dispatched", "In Progress", "Driver Accepted", "En Route"])
    .is("deleted_at", null)
    .maybeSingle();

  if (dispatch) {
    await supabase
      .from("vehicles")
      .update({ vehicle_status: "Dispatched" })
      .eq("vehicle_id", vehicleId);
    return;
  }

  // 3. Active trip (Trip Started, En Route, Arrived, Dispatched, Driver Accepted)
  const { data: trip } = await supabase
    .from("trips")
    .select("trip_id")
    .eq("vehicle_id", vehicleId)
    .in("trip_status", [
      "Trip Started",
      "En Route",
      "Arrived",
      "Dispatched",
      "Driver Accepted",
    ])
    .is("deleted_at", null)
    .maybeSingle();

  if (trip) {
    await supabase
      .from("vehicles")
      .update({ vehicle_status: "Dispatched" })
      .eq("vehicle_id", vehicleId);
    return;
  }

  // 4. Active reservation (Approved or Dispatched)
  const { data: reservation } = await supabase
    .from("vehiclereservations")
    .select("reservation_id")
    .eq("vehicle_id", vehicleId)
    .in("status", ["Approved", "Dispatched"])
    .is("deleted_at", null)
    .maybeSingle();

  if (reservation) {
    await supabase
      .from("vehicles")
      .update({ vehicle_status: "Reserved" })
      .eq("vehicle_id", vehicleId);
    return;
  }

  // 5. Nothing active
  await supabase
    .from("vehicles")
    .update({ vehicle_status: "Available" })
    .eq("vehicle_id", vehicleId);
}

/**
 * Recompute a driver's status based on current activity.
 *
 * Manual statuses (On Leave, Suspended) are never overridden.
 * Priority: On Trip > Available
 */
export async function syncDriverStatus(driverId) {
  const supabase = createClient();

  const { data: driver } = await supabase
    .from("drivers")
    .select("driver_status")
    .eq("driver_id", driverId)
    .single();

  if (!driver) return;

  if (driver.driver_status === "On Leave" || driver.driver_status === "Suspended") {
    return;
  }

  // Active dispatch
  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("dispatch_id")
    .eq("driver_id", driverId)
    .in("status", ["Dispatched", "In Progress", "Driver Accepted", "En Route"])
    .is("deleted_at", null)
    .maybeSingle();

  if (dispatch) {
    await supabase
      .from("drivers")
      .update({ driver_status: "On Trip" })
      .eq("driver_id", driverId);
    return;
  }

  // Active trip
  const { data: trip } = await supabase
    .from("trips")
    .select("trip_id")
    .eq("driver_id", driverId)
    .in("trip_status", [
      "Trip Started",
      "En Route",
      "Arrived",
      "Dispatched",
      "Driver Accepted",
    ])
    .is("deleted_at", null)
    .maybeSingle();

  if (trip) {
    await supabase
      .from("drivers")
      .update({ driver_status: "On Trip" })
      .eq("driver_id", driverId);
    return;
  }

  await supabase
    .from("drivers")
    .update({ driver_status: "Available" })
    .eq("driver_id", driverId);
}

/**
 * Sync a reservation's status based on its linked dispatch.
 */
export async function syncReservationStatus(reservationId) {
  if (!reservationId) return;
  const supabase = createClient();

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("status")
    .eq("reservation_id", reservationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!dispatch) return;

  if (dispatch.status === "Completed") {
    await supabase
      .from("vehiclereservations")
      .update({ status: "Completed" })
      .eq("reservation_id", reservationId);
    return;
  }

  if (["Dispatched", "In Progress", "Driver Accepted", "En Route"].includes(dispatch.status)) {
    await supabase
      .from("vehiclereservations")
      .update({ status: "Dispatched" })
      .eq("reservation_id", reservationId);
  }
}

/**
 * Given a dispatch ID, find its linked reservation (if any) and sync it.
 */
export async function syncDispatchReservation(dispatchId) {
  if (!dispatchId) return;
  const supabase = createClient();

  const { data: dispatch } = await supabase
    .from("dispatchschedules")
    .select("reservation_id")
    .eq("dispatch_id", dispatchId)
    .single();

  if (dispatch?.reservation_id) {
    await syncReservationStatus(dispatch.reservation_id);
  }
}
