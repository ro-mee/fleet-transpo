import { createClient } from "@/lib/supabase/client";

export async function getDispatches(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("dispatchschedules")
    .select("*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(driver_id, employee_id, employees(first_name, last_name)), vehiclereservations(*), routes(*)")
    .is("deleted_at", null);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.date) query = query.gte("scheduled_departure", `${filters.date}T00:00:00`).lte("scheduled_departure", `${filters.date}T23:59:59`);
  if (filters.dispatch_number) query = query.ilike("dispatch_number", `%${filters.dispatch_number}%`);

  query = query.order("scheduled_departure", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getDispatchesByStatus() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dispatchschedules")
    .select("*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(driver_id, employee_id, employees(first_name, last_name))")
    .is("deleted_at", null);

  if (error) throw error;

  return {
    pending: data.filter((d) => d.status === "Pending"),
    approved: data.filter((d) => d.status === "Approved"),
    dispatched: data.filter((d) => d.status === "Dispatched"),
    inProgress: data.filter((d) => d.status === "In Progress" || d.status === "Driver Accepted" || d.status === "En Route"),
    completed: data.filter((d) => d.status === "Completed"),
  };
}

export async function getDispatch(id) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dispatchschedules")
    .select("*, vehicles(*), drivers(*, employees(*)), vehiclereservations(*), routes(*)")
    .eq("dispatch_id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createDispatch(dispatch) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dispatchschedules")
    .insert(dispatch)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDispatch(id, dispatch) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dispatchschedules")
    .update(dispatch)
    .eq("dispatch_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDispatchStatus(id, status) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dispatchschedules")
    .update({ status })
    .eq("dispatch_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
