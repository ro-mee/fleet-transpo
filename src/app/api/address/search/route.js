// Address typeahead — GET /api/address/search?q=&lat=&lon=
//
// Proxies TomTom Search v2 through the SERVER key, so neither the query nor the
// key reaches the browser. The client only ever sees /api/address/*.
//
// Returns suggestions WITHOUT coordinates. That is deliberate: a suggestion is
// "which place did you mean", and the browser has no use for a coordinate until
// one is chosen. Coordinates are resolved server-side by /api/address/geocode,
// which is also the only path that may set `verified` — so there is no request
// shape in which a client supplies its own coordinate for storage.

import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { addressGeocoder, MIN_QUERY_LENGTH } from "@/lib/address/provider";

export async function GET(req) {
  try {
    // Same resource as the routing proxy: address lookup is a maps capability.
    await requirePermission(req, "maps", "read");

    const sp = new URL(req.url).searchParams;
    const query = sp.get("q") ?? "";

    // A short query is not an error — it is someone still typing. Returning an
    // empty list keeps the client's debounced loop from having to special-case
    // it, and keeps a 2-character query from costing a provider call.
    if (query.trim().length < MIN_QUERY_LENGTH) {
      return ok({ suggestions: [] });
    }

    // `?? undefined` rather than the null `get()` returns: Number(null) is 0,
    // which is finite, so a null bias would silently pin results to the Gulf of
    // Guinea instead of being ignored.
    const suggestions = await addressGeocoder.search(query, {
      lat: sp.get("lat") ?? undefined,
      lon: sp.get("lon") ?? undefined,
    });

    return ok({ suggestions });
  } catch (e) {
    return handleError(e);
  }
}
