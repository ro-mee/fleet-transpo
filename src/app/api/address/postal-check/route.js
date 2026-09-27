import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { rateLimit } from "@/lib/rate-limit";
import { resolveBarangayChain } from "@/lib/geo/psgc";
import { checkPostalCodeForLocality } from "@/services/postal-code.service";
import { postalProvinceName } from "@/lib/address/postal-reference";

/** Check only the PSGC locality and ZIP; street and house details never leave the form. */
export async function POST(req) {
  try {
    const session = await requirePermission(req, "drivers", "update");
    const limit = await rateLimit(`address:postal-check:${session.user.employeeId}`, {
      limit: 30,
      windowMs: 60_000,
    });
    if (!limit.allowed) {
      return Response.json(
        { error: "Too many ZIP checks. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter || 60) } }
      );
    }

    const body = await parseBody(req);
    const code = String(body?.psgcBarangayCode ?? "").trim();
    const postalCode = String(body?.postalCode ?? "").trim();
    if (!/^\d{9,10}$/.test(code)) return err("Select a barangay before checking the ZIP.", 400);
    if (!/^\d{4}$/.test(postalCode)) return err("ZIP code must be 4 digits.", 400);

    const chain = await resolveBarangayChain(code);
    if (!chain) return err("That barangay is not in the address database.", 400);

    try {
      const result = await checkPostalCodeForLocality({
        province: postalProvinceName(chain),
        locality: chain.city?.name,
        postalCode,
      });
      return ok(result);
    } catch {
      return ok({ status: "unknown", postalCodes: [] });
    }
  } catch (error) {
    return handleError(error);
  }
}
