import { query } from "@/lib/db";
import { getSystemInstructions } from "./prompt-loader";
import { logAiRequest } from "./logger";

/**
 * Fetches default active AI provider from aiproviders table or env.
 *
 * NOTE: The aiproviders table is created by migration 031, not here. This used
 * to run CREATE TABLE IF NOT EXISTS on every call — a DDL round-trip on the AI
 * hot path. Migration 031 made that per-request DDL unnecessary.
 */
export async function getActiveAiProvider(providerName = null) {
  try {
    const { rows } = providerName
      ? await query(
          `SELECT * FROM aiproviders WHERE is_enabled = true AND LOWER(provider_name) = LOWER($1) LIMIT 1`,
          [providerName]
        )
      : await query(
          `SELECT * FROM aiproviders WHERE is_enabled = true AND is_default = true LIMIT 1`
        );

    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.warn("AI Provider DB Check:", err.message);
  }

  // Environment variable fallback
  if (!providerName && process.env.OPENAI_API_KEY) {
    return {
      provider_name: "OpenAI",
      display_name: "OpenAI API",
      base_url: "https://api.openai.com/v1",
      api_key: process.env.OPENAI_API_KEY,
      model_name: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 1500,
      timeout_ms: 10000,
    };
  }

  if ((!providerName || providerName.toLowerCase() === "gemini") && process.env.GEMINI_API_KEY) {
    return {
      provider_name: "Gemini",
      display_name: "Google Gemini",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
      api_key: process.env.GEMINI_API_KEY,
      model_name: "gemini-1.5-flash",
      temperature: 0.7,
      max_tokens: 1500,
      timeout_ms: 10000,
    };
  }

  return null; // Return null if no LLM provider configured
}

/**
 * Multi-Provider LLM Completion Adapter
 */
export async function executeLlmCompletion({
  feature_used = "General AI",
  user_prompt,
  image_url = null,
  system_instructions = null,
  user_email = null,
  max_tokens = null,
  defer_log = false,
  prefer_fast_model = false,
  provider_name = null,
}) {
  const startTime = Date.now();
  const provider = await getActiveAiProvider(provider_name);

  // If no LLM provider configured, return fallback signal
  if (!provider || !provider.api_key) {
    await logAiRequest({
      feature_used,
      provider_name: "Rule-Based",
      model_name: "Deterministic Fallback (No Key)",
      duration_ms: Date.now() - startTime,
      status: "Success",
      user_email,
    });
    return { success: false, fallback: true, reason: "No active LLM provider configured" };
  }

  const instructions = system_instructions || await getSystemInstructions();
  const selectedModel =
    prefer_fast_model && provider.provider_name?.toLowerCase() === "deepseek"
      ? "deepseek-chat"
      : provider.model_name || "gpt-4o-mini";

  try {
    let endpointUrl = provider.base_url || "https://api.openai.com/v1";
    if (endpointUrl.endsWith("/")) endpointUrl = endpointUrl.slice(0, -1);

    let headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.api_key}`,
    };

    if (provider.custom_headers) {
      headers = { ...headers, ...provider.custom_headers };
    }

    const userMessageContent = image_url
      ? [
          { type: "text", text: user_prompt },
          { type: "image_url", image_url: { url: image_url } },
        ]
      : user_prompt;

    const payload = {
      model: selectedModel,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: userMessageContent },
      ],
      temperature: Number(provider.temperature) || 0.7,
      max_tokens: Number(max_tokens) || Number(provider.max_tokens) || 1500,
    };

    // Controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), provider.timeout_ms || 10000);

    const fullUrl = `${endpointUrl}/chat/completions`;
    const response = await fetch(fullUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Provider HTTP ${response.status}: ${errText.substring(0, 150)}`);
    }

    const data = await response.json();
    const duration_ms = Date.now() - startTime;

    const content = data.choices?.[0]?.message?.content || "";
    const prompt_tokens = data.usage?.prompt_tokens || 0;
    const completion_tokens = data.usage?.completion_tokens || 0;
    const total_tokens = data.usage?.total_tokens || 0;

    const logRequest = logAiRequest({
      feature_used,
      provider_name: provider.display_name || provider.provider_name,
      model_name: selectedModel,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      duration_ms,
      status: "Success",
      user_email,
    });
    if (defer_log) void logRequest.catch(() => {});
    else await logRequest;

    return {
      success: true,
      content,
      tokens: { prompt_tokens, completion_tokens, total_tokens },
      provider: provider.display_name,
    };
  } catch (err) {
    const duration_ms = Date.now() - startTime;
    const logRequest = logAiRequest({
      feature_used,
      provider_name: provider.display_name || provider.provider_name,
      model_name: selectedModel,
      duration_ms,
      status: "Error",
      error_message: err.message,
      user_email,
    });
    if (defer_log) void logRequest.catch(() => {});
    else await logRequest;

    return {
      success: false,
      fallback: true,
      reason: err.message,
    };
  }
}
