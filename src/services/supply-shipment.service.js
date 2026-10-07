import { apiFetch } from "@/lib/api/client";

export function compareSupplyLoadFit(shipmentId) {
  return apiFetch("/api/supply/shipments/load-fit", {
    method: "POST",
    body: { shipment_id: shipmentId },
  });
}
