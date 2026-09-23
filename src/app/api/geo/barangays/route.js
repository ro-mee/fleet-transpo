import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { listBarangays } from "@/lib/geo/psgc";

// Barangays within a city or municipality — the innermost level of the cascade.
//
// This is the largest table (~42,000 rows nationally) and the reason the form
// loads one level at a time rather than shipping a dataset to the browser. One
// city's barangays are tens to a few hundred rows, small enough to send whole so
// the dropdown's type-to-filter can run client-side without a request per
// keystroke.
export async function GET(req) {
  try {
    await requirePermission(req, "maps", "read");

    const city = new URL(req.url).searchParams.get("city");
    if (!city) return err("city is required", 400);

    return ok(await listBarangays(city));
  } catch (e) {
    return handleError(e);
  }
}
