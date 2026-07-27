import { createClient } from "@/lib/supabase/client";

export async function getNotifications(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("notifications")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(50);

  if (filters.type) query = query.eq("type", filters.type);
  if (filters.is_read !== undefined) query = query.eq("is_read", filters.is_read);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function markAsRead(id) {
  const supabase = createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("notification_id", id);
  if (error) throw error;
}

export async function markAllAsRead() {
  const supabase = createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("is_read", false);
  if (error) throw error;
}

export async function deleteNotification(id) {
  const supabase = createClient();
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("notification_id", id);
  if (error) throw error;
}

export async function sendNotification(notification) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("notifications")
    .insert(notification)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function getNotificationIcon(type) {
  const icons = {
    Info: "info",
    Warning: "warning",
    Alert: "alert",
    Success: "success",
    Reservation: "calendar",
    Dispatch: "send",
    Maintenance: "wrench",
    Fuel: "fuel",
    Trip: "route",
  };
  return icons[type] || "info";
}
