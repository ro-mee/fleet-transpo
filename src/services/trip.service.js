import { createClient } from "@/lib/supabase/client";

export async function getTrips(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("trips")
    .select("*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(driver_id, employee_id, employees(first_name, last_name)), dispatchschedules(dispatch_number), routes(route_name), origin_location:origin_location_id(*), destination_location:destination_location_id(*)")
    .is("deleted_at", null);

  if (filters.status) query = query.eq("trip_status", filters.status);
  if (filters.vehicle_id) query = query.eq("vehicle_id", filters.vehicle_id);
  if (filters.driver_id) query = query.eq("driver_id", filters.driver_id);
  if (filters.from_date) query = query.gte("start_time", filters.from_date);
  if (filters.to_date) query = query.lte("start_time", filters.to_date);

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getActiveTrips() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*, vehicles(vehicle_id, plate_number, vehicle_name, vehicle_status), drivers(driver_id, employee_id, employees(first_name, last_name)), dispatchschedules(dispatch_number), origin_location:origin_location_id(*), destination_location:destination_location_id(*)")
    .in("trip_status", ["Dispatched", "Driver Accepted", "Trip Started", "En Route", "Arrived"])
    .is("deleted_at", null)
    .order("start_time", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getTrip(id) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*, vehicles(*, vehiclecategories(*)), drivers(*, employees(*)), dispatchschedules(*), routes(*), origin_location:origin_location_id(*), destination_location:destination_location_id(*)")
    .eq("trip_id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createTrip(trip) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("trips")
    .insert(trip)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTrip(id, trip) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("trips")
    .update(trip)
    .eq("trip_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTripStatus(id, status) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("trips")
    .update({ trip_status: status })
    .eq("trip_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function startTrip(id, startData) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("trips")
    .update({
      trip_status: "Trip Started",
      start_time: new Date().toISOString(),
      start_odometer: startData.odometer,
      ...startData,
    })
    .eq("trip_id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function completeTrip(id, endData) {
  const supabase = createClient();
  const distance = endData.end_odometer - (endData.start_odometer || 0);
  const duration = endData.start_time
    ? Math.round((new Date() - new Date(endData.start_time)) / 60000)
    : 0;

  const { data, error } = await supabase
    .from("trips")
    .update({
      trip_status: "Completed",
      end_time: new Date().toISOString(),
      end_odometer: endData.end_odometer,
      distance: distance > 0 ? distance : endData.distance,
      actual_duration: duration,
      ...endData,
    })
    .eq("trip_id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getTripLocations(tripId) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("gpstracking")
    .select("*")
    .eq("trip_id", tripId)
    .order("recorded_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getLatestLocations() {
  const supabase = createClient();
  const { data: activeTrips } = await supabase
    .from("trips")
    .select("trip_id, vehicle_id, driver_id")
    .in("trip_status", ["Trip Started", "En Route", "Arrived"]);

  if (!activeTrips?.length) return [];

  const vehicleIds = activeTrips.map((t) => t.vehicle_id);
  const { data, error } = await supabase
    .rpc("get_latest_vehicle_locations", { vehicle_ids: vehicleIds });

  if (error) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("gpstracking")
      .select("*, vehicles(vehicle_id, plate_number, vehicle_name)")
      .in("vehicle_id", vehicleIds)
      .order("recorded_at", { ascending: false });

    if (fallbackError) throw fallbackError;

    const latest = {};
    fallback.forEach((loc) => {
      if (!latest[loc.vehicle_id]) {
        latest[loc.vehicle_id] = loc;
      }
    });
    return Object.values(latest);
  }

  return data;
}
