// Resolve a selected suggestion into an authoritative address —
// GET /api/address/geocode?place_id=&q=
//
// THIS IS THE ONLY PLACE COORDINATES BECOME TRUSTWORTHY. The client sends a
// place id — an opaque handle it got from /api/address/search, meaning only "the
// operator picked this row" — and the server asks the provider what that place
// actually is. The response's coordinates, components and postal code are the
// provider's, never the caller's.
//
// The client cannot forge this — but not for the reason this comment used to
// give. It claimed the write paths re-resolve the place id through
// `resolveAddress()`. Nothing imports that function except its own test, so no
// write path calls it, and the claim was false.
//
// The real mechanism is structural. A write path accepts a picked
// `structured_address`, derives the region, province and city itself from
// `psgc_barangay_code`, and writes the row with `provider = 'manual'`,
// `verified = false` and `providerPlaceId: null` — see
// src/lib/address/validate-structured.js. It has no parameter for a place id and
// none for a `verified` flag, so there is no request shape in which this
// response, or a client's imitation of it, could be stored as verified.
//
// The one coordinate a client DOES supply is the operator's pin, and it is
// stored as exactly what it is: an unverified manual claim about where a door
// is. The boundary is enforced on the write, not on this read.
//
// Coordinates ARE returned here, unlike from /search: the map preview needs
// them. That is not a weakening — the write path's refusal to accept a
// `verified` flag is what makes them safe to hand over.

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
