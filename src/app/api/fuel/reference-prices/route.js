import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fuelPrices, fuelSchemaError } from "@/lib/fuel/price-repository";

export async function GET(req) {
  try {
    await requirePermission(req, "fuelallocations", "read");
    await fuelPrices.activateDue();
    const rows = await fuelPrices.list();
    const { rows: settings } = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'fuel_price_region' LIMIT 1");
    return ok({ rows, region: settings[0]?.setting_value ?? null });
  } catch (error) { return handleError(fuelSchemaError(error)); }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "fuelallocations", "update");
    const body = await parseBody(req);
    const result = await fuelPrices.record(body, { verifierId: session.user.employeeId });
    if (!result.duplicate) await writeAudit(null, session, { action: "create", resource: "fuelallocations", resourceId: result.snapshot.snapshot_id, newValues: { reference_price_snapshot: result.snapshot } });
    return ok(result, result.duplicate ? 200 : 201);
  } catch (error) { return handleError(fuelSchemaError(error)); }
}

export async function PATCH(req) {
  try {
    const session = await requirePermission(req, "fuelallocations", "update");
    const body = await parseBody(req);
    const region = typeof body.region === "string" ? body.region.trim() : "";
    if (!region || region.length > 100) return err("Choose an estimate region (up to 100 characters).", 400);
    await fuelPrices.list(); // A setting cannot imply a working unapplied feature.
    await query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('fuel_price_region', $1::jsonb)
      ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`, [JSON.stringify(region)]);
    await writeAudit(null, session, { action: "update", resource: "fuelallocations", newValues: { fuel_price_region: region } });
    return ok({ region });
  } catch (error) { return handleError(fuelSchemaError(error)); }
}
