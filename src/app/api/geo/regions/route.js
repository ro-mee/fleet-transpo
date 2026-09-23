import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { listRegions } from "@/lib/geo/psgc";

// Philippine regions for the address cascade's first level.
//
// Reference data, not sensitive — but not public either. It is gated on the same
// `maps:read` permission the TomTom proxy uses, because that is the resource that
// already governs "may this user resolve locations". Giving geography its own
// permission would mean a role could see the address form but not fill it in.
export async function GET(req) {
  try {
    await requirePermission(req, "maps", "read");
    return ok(await listRegions());
  } catch (e) {
    return handleError(e);
  }
}
