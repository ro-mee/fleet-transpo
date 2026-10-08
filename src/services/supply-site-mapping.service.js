import { apiFetch } from "@/lib/api/client";

export function getSupplySiteMappings() {
  return apiFetch("/api/supply/site-mappings");
}

export function saveSupplySiteMapping(mapping) {
  return apiFetch("/api/supply/site-mappings", {
    method: "PUT",
    body: mapping,
  });
}
