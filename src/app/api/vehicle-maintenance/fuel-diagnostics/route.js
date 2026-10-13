import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { FUEL_DIAGNOSTIC_MARKER, FUEL_DIAGNOSTIC_TYPE } from "@/lib/fuel/diagnostic";

export async function GET(req) {
  try {
    await requirePermission(req, "maintenance", "create");
    const raw = new URL(req.url).searchParams.get("vehicle_ids") ?? "";
    // "12, 13" (with spaces) is the same request as "12,13": trim segments
    // before validating so callers are not 400'd on whitespace. Empty
    // segments ("1,,2") still fail below — only whitespace is forgiven.
    const ids = raw.split(",").map((s) => s.trim());
    if (ids.length > 10 || ids.some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647)) {
      return err("Provide between 1 and 10 positive integer vehicle ids.", 400);
    }
    const { rows } = await query(
      `SELECT DISTINCT ON (vehicle_id) maintenance_id, vehicle_id, status, maintenance_date
         FROM vehiclemaintenance
        WHERE vehicle_id = ANY($1::int[]) AND deleted_at IS NULL
          AND maintenance_type = $2 AND remarks LIKE $3 AND status = ANY($4)
        ORDER BY vehicle_id, created_at DESC, maintenance_id DESC`,
      [ids.map(Number), FUEL_DIAGNOSTIC_TYPE, `%${FUEL_DIAGNOSTIC_MARKER}%`, ["Scheduled", "In Progress", "Pending Inspection"]]
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}
