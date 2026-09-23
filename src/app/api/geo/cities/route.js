import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { listCities } from "@/lib/geo/psgc";

// Cities and municipalities, filtered by province OR by region.
//
// Both parameters are accepted and exactly one applies. The region form is not a
// fallback for the province one — it is the primary path for province-less
// regions, where no province exists to filter by.
export async function GET(req) {
  try {
    await requirePermission(req, "maps", "read");

    const sp = new URL(req.url).searchParams;
    const province = sp.get("province");
    const region = sp.get("region");

    if (!province && !region) {
      return err("province or region is required", 400);
    }

    return ok(await listCities({ provinceCode: province, regionCode: region }));
  } catch (e) {
    return handleError(e);
  }
}
