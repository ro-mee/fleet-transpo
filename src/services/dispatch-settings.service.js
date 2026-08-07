import { query } from "@/lib/db";
import { mergeDispatchPolicy } from "@/lib/dispatch-policy";

const POLICY_KEY = "dispatch_policy";

/** Read the stored dispatch policy (defaults when unset). */
export async function getDispatchPolicy() {
  const { rows } = await query(
    `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
    [POLICY_KEY]
  );
  return mergeDispatchPolicy(rows[0]?.setting_value);
}

/** Upsert the dispatch policy. Returns the merged (persisted) policy. */
export async function saveDispatchPolicy(policy, actorId) {
  const merged = mergeDispatchPolicy(policy);
  await query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [POLICY_KEY, JSON.stringify(merged), actorId || null]
  );
  return merged;
}
