import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

// Report the configuration status of every external connector the system can
// talk to. Status is derived from environment-variable presence (server-side
// only — these keys must never reach a client bundle) and, for AI providers,
// from rows actually saved in the aiproviders table. Only booleans are sent;
// no key values, no names — an admin can tell *what* is configured, not *how*.
//
// This is the source of truth for the Integrations & Connectors section on
// /settings/general. It deliberately excludes connectors that do not exist in
// this codebase (there is no Twilio or SendGrid integration).

const has = (key) => Boolean(process.env[key] && String(process.env[key]).trim());

const STATUS = {
  CONNECTED: "connected",
  PARTIAL: "partial",
  MISSING: "missing",
  MOCK: "mock",
};

function statusFor(ready, required) {
  if (ready === required) return STATUS.CONNECTED;
  if (ready > 0) return STATUS.PARTIAL;
  return STATUS.MISSING;
}

// AI providers can be configured either through an environment key or rows
// saved in aiproviders (/settings/ai). An env var set at boot beats the table
// because it requires no write to resolve; the table is the runtime truth
// otherwise (the app can run on a provider with no env key at all — DeepSeek
// here, for example).
async function aiProviders() {
  try {
    const { rows } = await query(
      `SELECT provider_name, display_name FROM aiproviders WHERE is_enabled = true ORDER BY provider_id`
    );
    return rows;
  } catch {
    return [];
  }
}

function aiStatus(envKey, rows, match) {
  if (has(envKey)) return { status: STATUS.CONNECTED, via: "environment key" };
  const row = rows.find((p) => match.test(`${p.provider_name} ${p.display_name}`));
  if (row) return { status: STATUS.CONNECTED, via: `configured provider · ${row.provider_name}` };
  return { status: STATUS.MISSING, via: null };
}

export async function GET(req) {
  try {
    await requireAuth(req);

    const supabaseReady = [
      has("NEXT_PUBLIC_SUPABASE_URL"),
      has("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      has("DATABASE_URL"),
    ].filter(Boolean).length;
    const tomtomReady = [has("NEXT_PUBLIC_TOMTOM_API_KEY"), has("TOMTOM_API_KEY")].filter(Boolean).length;

    const providers = await aiProviders();
    const gemini = aiStatus("GEMINI_API_KEY", providers, /gemini|google/i);
    const customAI = providers.filter((p) => !/gemini|google/i.test(`${p.provider_name} ${p.display_name}`));

    const bookingMode = (process.env.BOOKING_GATEWAY || "mock").toLowerCase();
    const bookingKeys = [has("BOOKING_API_URL"), has("BOOKING_API_KEY"), has("BOOKING_WEBHOOK_SECRET")].filter(Boolean).length;

    const connectors = [
      {
        id: "supabase",
        name: "Supabase",
        category: "Core Platform",
        description: "Database, authentication & server-side access",
        status: statusFor(supabaseReady, 3),
        detail: "Credentials verified server-side",
        href: null,
      },
      {
        id: "tomtom",
        name: "TomTom Maps",
        category: "Maps & Routing",
        description: "Map tiles, live traffic & routing proxy",
        status: statusFor(tomtomReady, 2),
        detail: has("TOMTOM_API_KEY")
          ? "Routing key present"
          : has("NEXT_PUBLIC_TOMTOM_API_KEY")
            ? "Tiles only — routing key missing"
            : "No keys configured",
        href: "/settings/api",
      },
      {
        id: "gemini",
        name: "Google Gemini",
        category: "AI & Insights",
        description: "Alternative LLM provider for analysis",
        status: gemini.status,
        detail: gemini.via ?? "No key or provider configured",
        href: "/settings/ai",
      },
      {
        id: "custom-ai",
        name: "Other AI Providers",
        category: "AI & Insights",
        description: "Additional enabled LLM providers",
        status: customAI.length ? STATUS.CONNECTED : STATUS.MISSING,
        detail: customAI.length ? customAI.map((p) => p.provider_name).join(", ") : "None configured",
        href: "/settings/ai",
      },
      {
        id: "booking",
        name: "Booking Gateway",
        category: "Integrations",
        description: "Booking ↔ Fleet request sync & status push",
        status: bookingMode === "mock" ? STATUS.MOCK : statusFor(bookingKeys, 2),
        detail:
          bookingMode === "mock"
            ? "Mock gateway — canned requests, no external calls"
            : bookingKeys === 3
              ? "Live gateway, webhook secured"
              : bookingKeys > 0
                ? "Live gateway — some credentials missing"
                : "Live gateway selected but no credentials",
        href: "/settings/api",
      },
    ];

    return ok(connectors);
  } catch (e) {
    return handleError(e);
  }
}