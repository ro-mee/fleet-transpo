import { createClient } from "@/lib/supabase/client";

const reservationSelect = `
  *,
  vehicles(vehicle_id, plate_number, vehicle_name),
  drivers(driver_id, employee_id, employees(first_name, last_name)),
  service_types(service_type_id, service_name, icon, color),
  booking_channels(channel_id, channel_name),
  pickup_location:pickup_location_id(*),
  dropoff_location:dropoff_location_id(*)
`;

export async function getReservations(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("vehiclereservations")
    .select(reservationSelect)
    .is("deleted_at", null);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
  if (filters.date) query = query.eq("reservation_date", filters.date);
  if (filters.vehicle_id) query = query.eq("vehicle_id", filters.vehicle_id);
  if (filters.service_type_id) query = query.eq("service_type_id", filters.service_type_id);
  if (filters.external_booking_id) query = query.eq("external_booking_id", filters.external_booking_id);
  if (filters.source_system) query = query.eq("integration_source", filters.source_system);

  if (filters.from_date) query = query.gte("reservation_date", filters.from_date);
  if (filters.to_date) query = query.lte("reservation_date", filters.to_date);

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getReservation(id) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehiclereservations")
    .select(`${reservationSelect}, branches(*), dispatchschedules(*)`)
    .eq("reservation_id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createReservation(reservation) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehiclereservations")
    .insert(reservation)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateReservation(id, reservation) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehiclereservations")
    .update(reservation)
    .eq("reservation_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelReservation(id, reason = null) {
  const supabase = createClient();
  const updates = { status: "Cancelled" };
  if (reason) updates.cancellation_reason = reason;
  const { data, error } = await supabase
    .from("vehiclereservations")
    .update(updates)
    .eq("reservation_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getReservationConflicts(vehicleId, date, pickupTime, estimatedReturn) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehiclereservations")
    .select("reservation_id, pickup_time, estimated_return_time")
    .eq("vehicle_id", vehicleId)
    .eq("reservation_date", date)
    .in("status", ["Pending", "Approved", "Dispatched"])
    .not("reservation_id", "is", null);

  if (error) throw error;

  if (!pickupTime || !estimatedReturn) return [];

  const pickup = new Date(`1970-01-01T${pickupTime}`);
  const ret = new Date(`1970-01-01T${estimatedReturn}`);

  return data.filter((r) => {
    const rPickup = new Date(`1970-01-01T${r.pickup_time}`);
    const rReturn = new Date(`1970-01-01T${r.estimated_return_time}`);
    return pickup < rReturn && ret > rPickup;
  });
}

export async function linkToExternalBooking(reservationId, externalBookingId, sourceSystem) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehiclereservations")
    .update({
      external_booking_id: externalBookingId,
      integration_source: sourceSystem,
    })
    .eq("reservation_id", reservationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getServiceTypes() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("service_types")
    .select("*")
    .eq("status", "Active")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getBookingChannels() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("booking_channels")
    .select("*")
    .eq("status", "Active")
    .order("channel_id", { ascending: true });
  if (error) throw error;
  return data || [];
}
