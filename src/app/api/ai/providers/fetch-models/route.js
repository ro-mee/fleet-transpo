import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function POST(req) {
  try {
    await requirePermission(req, "ai_settings", "update");
    const body = await parseBody(req);
    const { base_url, api_key } = body;

    let url = base_url || "https://api.openai.com/v1";
    if (url.endsWith("/")) url = url.slice(0, -1);

    // A masked key (••••) means the user is editing an existing provider and has
    // not retyped a new one. We do not have the real key client-side, so an
    // unauthenticated /models request would only return a confusing 401.
    if (!api_key || api_key.startsWith("••••")) {
      return err("Re-enter the API key to fetch models from the provider", 400);
    }

    const modelsUrl = `${url}/models`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${api_key}`,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    let response;
    try {
      response = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

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

    return ok({ models });
  } catch (e) {
    return handleError(e);
  }
}
