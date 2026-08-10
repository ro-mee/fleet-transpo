import { apiFetch } from "@/lib/api/client";

export async function globalSearch(q) {
  return apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
}
