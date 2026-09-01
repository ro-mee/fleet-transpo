import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { isUrl } from "@/lib/validation";

// Strips the raw api_key before a row leaves the server. Matches the masking
// the GET handler applies so POST/PUT responses never expose the secret.
function maskProvider(row) {
  return {
    ...row,
    api_key_masked: row.api_key ? `••••••••••••${row.api_key.slice(-4)}` : null,
    api_key: undefined,
  };
}

export async function GET(req) {
  try {
    await requirePermission(req, "ai_settings", "read");

    // aiproviders is created by migration 031, not per request. The DDL that
    // used to run here had already drifted — it omitted target_feature.
    const { rows } = await query(`SELECT * FROM aiproviders ORDER BY is_default DESC, provider_id ASC`);
    return ok(rows.map(maskProvider));
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requirePermission(req, "ai_settings", "update");
    const body = await parseBody(req);

    if (!body.display_name || !body.model_name) {
      return err("Display name and Model name are required", 400);
    }

    const errors = validateBody(body, {
      provider_name: { maxLength: 50, label: "Provider name" },
      display_name: { required: true, maxLength: 100, label: "Display name" },
      base_url: { maxLength: 255, label: "Base URL" },
      model_name: { required: true, maxLength: 100, label: "Model name" },
      temperature: { type: "positiveNumber", max: 9.99, label: "Temperature" },
      max_tokens: { type: "positiveNumber", min: 1, max: 1000000, integer: true, label: "Max tokens" },
      timeout_ms: { type: "positiveNumber", min: 1000, max: 600000, integer: true, label: "Timeout" },
    });
    if (body.base_url && !isUrl(body.base_url)) {
      errors.base_url = "Base URL must be a valid URL.";
    }
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    await query(
      `INSERT INTO aiproviders (
        provider_name, display_name, base_url, api_key, model_name,
        temperature, max_tokens, timeout_ms, is_enabled, is_default
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        body.provider_name || "Custom",
        body.display_name,
        body.base_url || "https://api.openai.com/v1",
        body.api_key || null,
        body.model_name,
        body.temperature ?? 0.7,
        body.max_tokens ?? 1500,
        body.timeout_ms ?? 10000,
        body.is_enabled ?? true,
        body.is_default ?? false,
      ]
    );

    const { rows: [newProvider] } = await query(
      `SELECT * FROM aiproviders ORDER BY provider_id DESC LIMIT 1`
    );
    if (!newProvider) return err("Failed to create provider", 500);

    if (body.is_default) {
      await query(`UPDATE aiproviders SET is_default = false WHERE provider_id != $1`, [newProvider.provider_id]);
    }

    return ok(maskProvider(newProvider), 201);
  } catch (e) { return handleError(e); }
}
