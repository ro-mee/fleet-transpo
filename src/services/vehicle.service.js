import { createClient } from "@/lib/supabase/client";

export async function getVehicles(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("vehicles")
    .select("*, vehiclecategories(*)")
    .is("deleted_at", null);

  if (filters.status) query = query.eq("vehicle_status", filters.status);
  if (filters.category_id) query = query.eq("category_id", filters.category_id);
  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
  if (filters.search) query = query.or(
    `plate_number.ilike.%${filters.search}%,vehicle_name.ilike.%${filters.search}%`
  );

  if (filters.page && filters.pageSize) {
    const from = (filters.page - 1) * filters.pageSize;
    const to = from + filters.pageSize - 1;
    query = query.range(from, to);
  }

  query = query.order("vehicle_id", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getVehicle(id) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicles")
    .select("*, vehiclecategories(*), branches(*)")
    .eq("vehicle_id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createVehicle(vehicle) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicles")
    .insert(vehicle)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVehicle(id, vehicle) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicles")
    .update(vehicle)
    .eq("vehicle_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteVehicle(id) {
  const supabase = createClient();
  const { error } = await supabase
    .from("vehicles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("vehicle_id", id);
  if (error) throw error;
}

export async function getAvailableVehicles(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("vehicles")
    .select("*, vehiclecategories(*)")
    .eq("vehicle_status", "Available")
    .is("deleted_at", null);

  if (filters.category_id) query = query.eq("category_id", filters.category_id);
  if (filters.min_capacity) query = query.gte("seating_capacity", filters.min_capacity);
  if (filters.fuel_type) query = query.eq("fuel_type", filters.fuel_type);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getVehicleCategories() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehiclecategories")
    .select("*")
    .eq("status", "Active")
    .is("deleted_at", null)
    .order("category_name");
  if (error) throw error;
  return data;
}

export async function getVehicleMaintenance(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("vehiclemaintenance")
    .select("*, vehicles(vehicle_id, plate_number, vehicle_name)")
    .is("deleted_at", null);

  if (filters.vehicle_id) query = query.eq("vehicle_id", filters.vehicle_id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from_date) query = query.gte("maintenance_date", filters.from_date);
  if (filters.to_date) query = query.lte("maintenance_date", filters.to_date);

  query = query.order("maintenance_date", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createVehicleMaintenance(record) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehiclemaintenance")
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVehicleMaintenance(id, record) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehiclemaintenance")
    .update(record)
    .eq("maintenance_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getVehicleDocuments(vehicleId) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicledocuments")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .is("deleted_at", null)
    .order("expiry_date", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createVehicleDocument(doc) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicledocuments")
    .insert(doc)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVehicleDocument(id, doc) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vehicledocuments")
    .update(doc)
    .eq("document_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteVehicleDocument(id) {
  const supabase = createClient();
  const { error } = await supabase
    .from("vehicledocuments")
    .update({ deleted_at: new Date().toISOString(), status: "Inactive" })
    .eq("document_id", id);
  if (error) throw error;
}
