import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { resolveBarangayChain } from "@/lib/geo/psgc";

// The full Region → Province → City → Barangay chain for one barangay code.
//
// Used by the address form when loading an EXISTING address for editing: the row
// stores one `psgc_barangay_code` and the display names, and this derives the
// codes needed to populate all four dropdowns. Storing a code per level instead
// would be one more set of values to keep consistent for no benefit.
//
// It is also the shape server-side validation uses — see
// `src/lib/address/validate-structured.js`, which DERIVES the stored region,
// province and city from this chain rather than comparing anything the client
// sent. The client's geography text is discarded, not reconciled; reading this
// route as a mismatch check would misdescribe what protects the write.
export async function GET(req) {
  try {
    await requirePermission(req, "maps", "read");

    const barangay = new URL(req.url).searchParams.get("barangay");
    if (!barangay) return err("barangay is required", 400);

    const chain = await resolveBarangayChain(barangay);
    // A miss is a 404 rather than an empty 200: the caller must be able to tell
    // "this code is unknown" from "this code resolved to nothing", and only the
    // former is a rejection.
    if (!chain) return err("Unknown barangay code", 404);

    return ok(chain);
  } catch (e) {
    return handleError(e);
  }
}
