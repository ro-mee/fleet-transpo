import { createClient } from "@/lib/supabase/client";

export async function getRoutes(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("routes")
    .select("*, origin_location:origin_location_id(*), destination_location:destination_location_id(*)")
    .is("deleted_at", null)
    .eq("status", "Active");

  if (filters.search) {
    query = query.or(
      `route_name.ilike.%${filters.search}%,origin_location.name.ilike.%${filters.search}%,destination_location.name.ilike.%${filters.search}%`
    );
  }

  query = query.order("route_name");

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getRoute(id) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("routes")
    .select("*, origin_location:origin_location_id(*), destination_location:destination_location_id(*)")
    .eq("route_id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createRoute(route) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("routes")
    .insert(route)
    .select("*, origin_location:origin_location_id(*), destination_location:destination_location_id(*)")
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoute(id, route) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("routes")
    .update(route)
    .eq("route_id", id)
    .select("*, origin_location:origin_location_id(*), destination_location:destination_location_id(*)")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRoute(id) {
  const supabase = createClient();
  const { error } = await supabase
    .from("routes")
    .update({ deleted_at: new Date().toISOString(), status: "Inactive" })
    .eq("route_id", id);
  if (error) throw error;
}

export async function upsertLocation(location) {
  const supabase = createClient();
  if (location.location_id) {
    const { data, error } = await supabase
      .from("locations")
      .update(location)
      .eq("location_id", location.location_id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("locations")
    .insert(location)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getLocations(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("locations")
    .select("*")
    .is("deleted_at", null)
    .eq("status", "Active")
    .order("name");

  if (filters.search) {
    query = query.ilike("name", `%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
