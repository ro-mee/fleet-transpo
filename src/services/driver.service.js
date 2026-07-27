import { createClient } from "@/lib/supabase/client";

export async function getDrivers(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("drivers")
    .select("*, employees(first_name, last_name, email, phone, status)")
    .is("deleted_at", null);

  if (filters.status) query = query.eq("driver_status", filters.status);
  if (filters.search) query = query.or(
    `license_number.ilike.%${filters.search}%`
  );

  if (filters.page && filters.pageSize) {
    const from = (filters.page - 1) * filters.pageSize;
    const to = from + filters.pageSize - 1;
    query = query.range(from, to);
  }

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  const driverIds = (data || []).map((d) => d.driver_id);
  if (driverIds.length === 0) return [];

  const { data: stats } = await supabase
    .from("driver_stats")
    .select("*")
    .in("driver_id", driverIds);

  const statsMap = {};
  (stats || []).forEach((s) => { statsMap[s.driver_id] = s; });

  return (data || []).map((d) => ({
    ...d,
    ...statsMap[d.driver_id] || {},
  }));
}

export async function getDriver(id) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("drivers")
    .select("*, employees(*)")
    .eq("driver_id", id)
    .single();
  if (error) throw error;

  const { data: stats } = await supabase
    .from("driver_stats")
    .select("*")
    .eq("driver_id", id)
    .single();

  return { ...data, ...stats || {} };
}

export async function createDriver(driver) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("drivers")
    .insert(driver)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDriver(id, driver) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("drivers")
    .update(driver)
    .eq("driver_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getDriverStats() {
  const supabase = createClient();
  const { data: allDrivers } = await supabase
    .from("drivers")
    .select("driver_id, driver_status")
    .is("deleted_at", null);

  if (!allDrivers) return { total: 0, available: 0, onTrip: 0, offDuty: 0, onLeave: 0, suspended: 0 };

  const total = allDrivers.length;
  const available = allDrivers.filter((d) => d.driver_status === "Available").length;
  const onTrip = allDrivers.filter((d) => d.driver_status === "On Trip").length;
  const offDuty = allDrivers.filter((d) => d.driver_status === "Off Duty").length;
  const onLeave = allDrivers.filter((d) => d.driver_status === "On Leave").length;
  const suspended = allDrivers.filter((d) => d.driver_status === "Suspended").length;

  return { total, available, onTrip, offDuty, onLeave, suspended };
}
