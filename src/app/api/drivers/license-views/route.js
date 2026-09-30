import { withTransaction } from "@/lib/db";
import { AuthError, parseBody, requireAuth, requirePermission, handleError } from "@/lib/api/utils";
import { writeAudit, writeAuditRequired } from "@/lib/audit";
import { maskLicenseNumber } from "@/lib/drivers/license-eligibility";
import { rateLimit } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCES = new Set(["staff_directory", "staff_detail", "leave_review", "dispatch"]);

async function boundedBody(req) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 16 * 1024) throw new AuthError("Request is too large", 413, "PAYLOAD_TOO_LARGE");
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 16 * 1024) throw new AuthError("Request is too large", 413, "PAYLOAD_TOO_LARGE");
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new AuthError("Invalid JSON body", 400, "BAD_REQUEST"); }
}

export async function POST(req) {
  let session = null;
  try {
    session = await requirePermission(req, "drivers", "read_all");
    const body = await boundedBody(req);
    const driverIds = [...new Set(Array.isArray(body.driver_ids) ? body.driver_ids : [])];
    if (driverIds.length < 1 || driverIds.length > 25 || driverIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
      throw new AuthError("driver_ids must contain 1 to 25 valid IDs", 400, "BAD_REQUEST");
    }
    if (!UUID.test(body.event_key || "")) throw new AuthError("A valid event_key is required", 400, "BAD_REQUEST");
    if (!SOURCES.has(body.source)) throw new AuthError("Invalid license view source", 400, "BAD_REQUEST");

    const actor = session.user.employeeId;
    const [minute, day] = await Promise.all([
      rateLimit(`license-view:staff:minute:${actor}`, { limit: 10, windowMs: 60_000 }),
      rateLimit(`license-view:staff:day:${actor}`, { limit: 60, windowMs: 86_400_000 }),
    ]);
    if (!minute.allowed || !day.allowed) throw new AuthError("License view limit reached. Try again later.", 429, "RATE_LIMITED");

    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT driver_id, license_number
           FROM drivers
          WHERE driver_id = ANY($1::integer[]) AND deleted_at IS NULL
          ORDER BY driver_id`,
        [driverIds.map(Number)]
      );
      if (rows.length !== driverIds.length) throw new AuthError("One or more drivers were not found", 404, "NOT_FOUND");

      await writeAuditRequired(tx, req, session, {
        action: "license_masked_viewed",
        resource: "drivers",
        resourceId: rows.length === 1 ? rows[0].driver_id : null,
        eventKey: body.event_key,
        newValues: { driver_ids: rows.map((row) => row.driver_id), source: body.source, count: rows.length },
      });
      return rows.map((row) => ({ driver_id: row.driver_id, license_number: maskLicenseNumber(row.license_number) }));
    });

    return Response.json({ drivers: result });
  } catch (error) {
    if (error?.status === 403) {
      const deniedSession = session || await requireAuth(req, ["*"]).catch(() => null);
      if (deniedSession) {
        const limit = await rateLimit(`sensitive-denial:license-mask:${deniedSession.user.employeeId}`, { limit: 5, windowMs: 60_000 });
        if (limit.allowed) await writeAudit(req, deniedSession, {
          action: "sensitive_access_denied",
          resource: "drivers",
          newValues: { reason_code: "permission_denied", scope: "masked_license" },
        });
      }
    }
    return handleError(error);
  }
}
