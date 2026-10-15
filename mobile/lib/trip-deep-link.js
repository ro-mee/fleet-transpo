/** A return hint only: this identity never selects or authorizes a trip. */
export function parseTripDeepLink(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const ids = url.searchParams.getAll('tripId');
    if (url.protocol !== 'fleetops:' || url.host || url.pathname !== '/redirect-trip' || url.hash ||
      ids.length !== 1 || !/^[1-9]\d{0,18}$/.test(ids[0])) return null;
    return { tripId: ids[0] };
  } catch { return null; }
}

// Map's authenticated focus refresh chooses the current server assignment.
export function resolveTripReturnRoute() { return '/(app)/(tabs)/map'; }
