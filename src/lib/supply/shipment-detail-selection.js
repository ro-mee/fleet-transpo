const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveShipmentDetailSelection(requestedId, shipments = []) {
  const available = Array.isArray(shipments) ? shipments : [];
  const requested = typeof requestedId === "string" ? requestedId.trim() : "";
  const linkedShipment = UUID_PATTERN.test(requested)
    ? available.find((shipment) => shipment?.supply_shipment_id === requested)
    : null;

  if (linkedShipment) {
    return { selectedId: linkedShipment.supply_shipment_id, linked: true, unavailable: false };
  }

  return {
    selectedId: available[0]?.supply_shipment_id ?? "",
    linked: false,
    unavailable: Boolean(requested),
  };
}
