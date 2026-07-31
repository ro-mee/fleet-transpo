import { parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function POST(req) {
  try {
    const body = await parseBody(req);
    const { base_url, api_key } = body;

    let url = base_url || "https://api.openai.com/v1";
    if (url.endsWith("/")) url = url.slice(0, -1);
    const modelsUrl = `${url}/models`;

    const headers = { "Content-Type": "application/json" };
    if (api_key && !api_key.startsWith("••••")) {
      headers["Authorization"] = `Bearer ${api_key}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const response = await fetch(modelsUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      return err(`Provider HTTP ${response.status}: ${errText.substring(0, 100)}`, 400);
    }

    const data = await response.json();
    let models = [];

    if (Array.isArray(data.data)) {
      models = data.data.map((m) => m.id).filter(Boolean);
    } else if (Array.isArray(data.models)) {
      models = data.models.map((m) => m.name || m.id).filter(Boolean);
    }

    if (models.length === 0) {
      models = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
    }

    return ok({ models });
  } catch (e) {
    // Fallback default models if fetch fails
    return ok({
      models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "claude-3-5-sonnet", "gemini-1.5-flash"],
      notice: `Direct fetch notice: ${e.message}`,
    });
  }
}
