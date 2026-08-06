import { apiFetch } from "@/lib/api/client";

export async function getHotelLocationSettings() {
  return apiFetch("/api/settings/hotel");
}

export async function updateHotelLocationSettings(payload) {
  return apiFetch("/api/settings/hotel", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function seedNaiaRoutes() {
  return apiFetch("/api/routes/seed-naia", {
    method: "POST",
  });
}
