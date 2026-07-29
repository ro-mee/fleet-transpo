import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getNotifications(filters = {}) {
  return apiFetch(`/api/notifications${buildQuery(filters)}`);
}

export async function markAsRead(id) {
  return apiFetch(`/api/notifications/${id}/read`, { method: "PUT" });
}

export async function markAllAsRead() {
  return apiFetch("/api/notifications/read-all", { method: "PUT" });
}

export async function deleteNotification(id) {
  return apiFetch(`/api/notifications/${id}`, { method: "DELETE" });
}

export async function sendNotification(notification) {
  return apiFetch("/api/notifications", { method: "POST", body: notification });
}

export function getNotificationIcon(type) {
  const icons = {
    Info: "info", Warning: "warning", Alert: "alert", Success: "success",
    Reservation: "calendar", Dispatch: "send", Maintenance: "wrench", Fuel: "fuel", Trip: "route",
  };
  return icons[type] || "info";
}
