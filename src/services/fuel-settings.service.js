import { query } from "@/lib/db";
import { mergeFuelPolicy, FUEL_POLICY_KEY } from "@/lib/fuel/fuel-policy";

/**
 * Read the stored fuel policy (defaults when unset).
 *
 * @param {object} [db] optional connection ({ query }). Pass the transaction
 *   when the read happens inside one to avoid multi-connection starvation.
 */
export async function getFuelPolicy(db = { query }) {
  const { rows } = await db.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
    [FUEL_POLICY_KEY]
  );
  return mergeFuelPolicy(rows[0]?.setting_value);
}

/** Upsert the fuel policy. Returns the merged (persisted) policy. */
export async function saveFuelPolicy(policy, actorId) {
  const merged = mergeFuelPolicy(policy);
  await query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [FUEL_POLICY_KEY, JSON.stringify(merged), actorId || null]
  );
  return merged;
}
