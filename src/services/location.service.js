import { apiFetch } from "@/lib/api/client";

export async function getLocations() {
  return apiFetch("/api/locations");
}
