import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { isUrl } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

// Strips the raw api_key before a row leaves the server so update responses
// never expose the secret.
function maskProvider(row) {
  return {
    ...row,
    api_key_masked: row.api_key ? `••••••••••••${row.api_key.slice(-4)}` : null,
    api_key: undefined,
  };
}

export async function PUT(req, { params }) {
  try {
    await requirePermission(req, "ai_settings", "update");
    const { id } = await params;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      provider_name: { maxLength: 50, label: "Provider name" },
      display_name: { maxLength: 100, label: "Display name" },
      base_url: { maxLength: 255, label: "Base URL" },
      model_name: { maxLength: 100, label: "Model name" },
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

    if (body.is_default) {
      await query(`UPDATE aiproviders SET is_default = false WHERE provider_id != $1`, [+id]);
    }

    const fields = [];
    const values = [];
    let idx = 1;

    for (const key of [
      "provider_name", "display_name", "base_url", "model_name",
      "temperature", "max_tokens", "timeout_ms", "is_enabled", "is_default"
    ]) {
      if (body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(body[key]);
      }
    }

    if (body.api_key && !body.api_key.startsWith("••••")) {
      fields.push(`api_key = $${idx++}`);
      values.push(body.api_key);
    }

    if (fields.length === 0) return err("No fields to update", 400);

    values.push(+id);
    const { rowCount } = await query(
      `UPDATE aiproviders SET ${fields.join(", ")}, updated_at = NOW() WHERE provider_id = $${idx}`,
      values
    );

    if (!rowCount) return err("Provider not found", 404);

    const { rows: [updated] } = await query(
      `SELECT * FROM aiproviders WHERE provider_id = $1`, [+id]
    );
    return ok(maskProvider(updated));
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    const session = await requirePermission(req, "ai_settings", "update");
    const { id } = await params;

    const { rowCount } = await query(`DELETE FROM aiproviders WHERE provider_id = $1`, [+id]);
    if (!rowCount) return err("Provider not found", 404);

    await writeAudit(req, session, { action: "delete", resource: "aiproviders", resourceId: id });

    return ok({ message: "AI Provider deleted successfully" });
  } catch (e) { return handleError(e); }
}

export async function POST(req, { params }) {
  try {
    await requirePermission(req, "ai_settings", "update");
    const { id } = await params;

    const { rows } = await query(`SELECT * FROM aiproviders WHERE provider_id = $1`, [+id]);
    if (!rows.length) return err("Provider not found", 404);

    const provider = rows[0];
    if (!provider.api_key) {
      return err("Provider missing API key", 400);
    }

    // Test connection HTTP ping
    let baseUrl = provider.base_url || "https://api.openai.com/v1";
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

    const testUrl = `${baseUrl}/models`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(testUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${provider.api_key}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return ok({ status: "Online", message: "Connection test successful!" });
    } else {
      return ok({ status: "Error", message: `HTTP ${response.status} response from provider endpoint` });
    }
  } catch (e) {
    return ok({ status: "Offline", message: `Connection failed: ${e.message}` });
  }
}
