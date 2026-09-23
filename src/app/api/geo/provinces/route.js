import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { listProvinces } from "@/lib/geo/psgc";

// Provinces within a region.
//
// An EMPTY RESULT IS A SUCCESSFUL ANSWER, and the caller depends on it: Metro
// Manila has no provinces, and `[]` here is what tells the form to stop requiring
// one and load its cities off the region instead. Returning 404 or an error for
// that case would make every NCR address unsaveable.
export async function GET(req) {
  try {
    await requirePermission(req, "maps", "read");

    const region = new URL(req.url).searchParams.get("region");
    if (!region) return err("region is required", 400);

    return ok(await listProvinces(region));
  } catch (e) {
    return handleError(e);
  }
}
