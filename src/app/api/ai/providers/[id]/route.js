import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function PUT(req, { params }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const body = await parseBody(req);

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
    return ok(updated);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    await requireAuth(req);
    const { id } = await params;

    const { rowCount } = await query(`DELETE FROM aiproviders WHERE provider_id = $1`, [+id]);
    if (!rowCount) return err("Provider not found", 404);

    return ok({ message: "AI Provider deleted successfully" });
  } catch (e) { return handleError(e); }
}

export async function POST(req, { params }) {
  try {
    await requireAuth(req);
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
