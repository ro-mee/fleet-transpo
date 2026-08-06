import { apiFetch } from "@/lib/api/client";

export async function getSystemActivity() {
  return apiFetch("/api/system/activity");
}
