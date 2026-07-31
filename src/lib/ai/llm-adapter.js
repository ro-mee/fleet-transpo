import { query } from "@/lib/db";
import { getSystemInstructions } from "./prompt-loader";
import { logAiRequest } from "./logger";

/**
 * Fetches default active AI provider from aiproviders table or env
 */
export async function getActiveAiProvider() {
  try {
    // Ensure table exists
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

    const { rows } = await query(
      `SELECT * FROM aiproviders WHERE is_enabled = true AND is_default = true LIMIT 1`
    );

    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.warn("AI Provider DB Check:", err.message);
  }

  // Environment variable fallback
  if (process.env.OPENAI_API_KEY) {
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

  if (process.env.GEMINI_API_KEY) {
    return {
      provider_name: "Gemini",
      display_name: "Google Gemini",
      base_url: "https://generativelanguage.googleapis.com/v1beta",
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
}) {
  const startTime = Date.now();
  const provider = await getActiveAiProvider();

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

  const instructions = system_instructions || getSystemInstructions();

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
      model: provider.model_name || "gpt-4o-mini",
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: userMessageContent },
      ],
      temperature: Number(provider.temperature) || 0.7,
      max_tokens: Number(provider.max_tokens) || 1500,
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

    await logAiRequest({
      feature_used,
      provider_name: provider.display_name || provider.provider_name,
      model_name: provider.model_name,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      duration_ms,
      status: "Success",
      user_email,
    });

    return {
      success: true,
      content,
      tokens: { prompt_tokens, completion_tokens, total_tokens },
      provider: provider.display_name,
    };
  } catch (err) {
    const duration_ms = Date.now() - startTime;
    await logAiRequest({
      feature_used,
      provider_name: provider.display_name || provider.provider_name,
      model_name: provider.model_name,
      duration_ms,
      status: "Error",
      error_message: err.message,
      user_email,
    });

    return {
      success: false,
      fallback: true,
      reason: err.message,
    };
  }
}
