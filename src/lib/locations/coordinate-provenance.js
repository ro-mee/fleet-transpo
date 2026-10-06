const NOT_INDEPENDENTLY_VERIFIED = "not independently verified";

function numericCoordinate(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

/**
 * Label only Fleet's active, complete, in-range registry points. The registry
 * is the routing source of record; it does not independently verify a point.
 */
export function getCoordinateProvenanceFields(location) {
  if (location?.is_active !== true || location.latitude == null || location.longitude == null) return {};

  const latitude = numericCoordinate(location.latitude);
  const longitude = numericCoordinate(location.longitude);
  if (latitude === null || longitude === null) return {};
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return {};

  return {
    coordinate_provenance: "canonical_registry",
    coordinate_provenance_note: NOT_INDEPENDENTLY_VERIFIED,
  };
}
