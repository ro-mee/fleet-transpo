// Resolve a selected suggestion into an authoritative address —
// GET /api/address/geocode?place_id=&q=
//
// THIS IS THE ONLY PLACE COORDINATES BECOME TRUSTWORTHY. The client sends a
// place id — an opaque handle it got from /api/address/search, meaning only "the
// operator picked this row" — and the server asks the provider what that place
// actually is. The response's coordinates, components and postal code are the
// provider's, never the caller's.
//
// The client cannot forge this. Posting `verified: true` and a coordinate pair
// straight to a write endpoint accomplishes nothing, because the write paths
// re-resolve the place id through `resolveAddress()` and ignore whatever the
// request claimed (see src/lib/address/validate.js).
//
// Coordinates ARE returned here, unlike from /search: the map preview needs
// them. That is not a weakening — the server's refusal to trust them is what
// makes them safe to hand over.

import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { addressGeocoder } from "@/lib/address/provider";

export async function GET(req) {
  try {
    await requirePermission(req, "maps", "read");

    const sp = new URL(req.url).searchParams;
    const placeId = (sp.get("place_id") ?? "").trim();
    if (!placeId) return err("place_id is required", 400);

    const address = await addressGeocoder.geocode(placeId, {
      // The original typed text, carried through so the stored record keeps what
      // the operator actually entered alongside the provider's rendering.
      rawInput: sp.get("q") ?? undefined,
    });

    // A provider outage and a place that no longer exists are indistinguishable
    // from here, and both mean the same thing to the caller: this could not be
    // verified just now. 502 rather than 500 because the failure is upstream.
    if (!address) {
      return err("This address could not be verified with the mapping provider.", 502);
    }

    return ok({ address });
  } catch (e) {
    return handleError(e);
  }
}
