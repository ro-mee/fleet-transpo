import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { isUrl } from "@/lib/validation";

export async function GET(req) {
  try {
    await requireAuth(req);
    await query(`
      CREATE TABLE IF NOT EXISTS aiproviders (
        provider_id SERIAL PRIMARY KEY,
        provider_name VARCHAR(50) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        base_url VARCHAR(255),
        api_key TEXT,
        model_name VARCHAR(100) NOT NULL,
        temperature DECIMAL(3,2) DEFAULT 0.70,
        max_tokens INT DEFAULT 1500,
        timeout_ms INT DEFAULT 10000,
        is_enabled BOOLEAN DEFAULT true,
        is_default BOOLEAN DEFAULT false,
        custom_headers JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const { rows } = await query(`SELECT * FROM aiproviders ORDER BY is_default DESC, provider_id ASC`);
    
    // Mask API keys before sending to frontend
    const maskedRows = rows.map((r) => ({
      ...r,
      api_key_masked: r.api_key ? `••••••••••••${r.api_key.slice(-4)}` : null,
      api_key: undefined, // Never expose raw secret
    }));

    return ok(maskedRows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin"]);
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

    return ok(newProvider, 201);
  } catch (e) { return handleError(e); }
}
