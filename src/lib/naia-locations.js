// Canonical NAIA curbside endpoints. Keep arrivals and departures separate so
// route resolution does not collapse distinct pickup/drop-off points.
export const NAIA_CANONICAL_LOCATIONS = [
  { name: "NAIA Terminal 1 - Arrivals", latitude: 14.50719, longitude: 121.00468 },
  { name: "NAIA Terminal 1 - Departures", latitude: 14.50688, longitude: 121.00474 },
  { name: "NAIA Terminal 2 - Arrivals", latitude: 14.51058, longitude: 121.01222 },
  { name: "NAIA Terminal 2 - Departures", latitude: 14.51002, longitude: 121.01245 },
  { name: "NAIA Terminal 3 - Arrivals (Bay 9)", latitude: 14.52048, longitude: 121.01445 },
  { name: "NAIA Terminal 3 - Departures (Bay 9)", latitude: 14.52035, longitude: 121.01427 },
];

export const NAIA_LEGACY_LOCATION_NAMES = [
  "NAIA Terminal 1",
  "NAIA Terminal 2",
  "NAIA Terminal 3",
  "NAIA Terminal 4",
];
