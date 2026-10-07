import { ok, err, handleError } from "@/lib/api/utils";
import { verifyServiceToken } from "@/lib/api/service-auth";
import {
  fetchReferencePrice,
  parseOfficialReference,
} from "@/lib/fuel/providers/official-reference";
import { fuelPrices, fuelSchemaError } from "@/lib/fuel/price-repository";

// Official price-provider sync (Release D Task 12).
//
// Authentication is the shared CRON_SECRET (verifyServiceToken), never a user
// session — same convention as /api/cron/sync. Fail-closed when unset.
//
// ACTIVATION GATE: no official machine-readable, legally usable source has
// been identified, so the scheduler stays DISABLED and manual verified
// snapshots are the only source. The route answers 503 with that fact unless
// FUEL_PRICE_PROVIDER_ENABLED=1, FUEL_PRICE_SOURCE_VERIFIED=1 and an HTTPS
// source approved by the operator. This is a deployment decision, never a
// trust assertion from provider data. No official source is guessed here.

function activation() {
  if (process.env.FUEL_PRICE_PROVIDER_ENABLED !== "1" || process.env.FUEL_PRICE_SOURCE_VERIFIED !== "1") return null;
  const id = String(process.env.FUEL_PRICE_SOURCE_ID ?? "").trim();
  const origin = String(process.env.FUEL_PRICE_SOURCE_URL ?? "").trim();
  if (!id || !origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { id, origin };
}

export async function GET(req) {
  try {
    const authz = verifyServiceToken(req, process.env.CRON_SECRET);
    if (!authz.ok) return err(authz.message, authz.status);

    const source = activation();
    if (!source) {
      return ok({
        outcome: "disabled",
        error: "Fuel price provider is not activated: no official source has been verified.",
        manual: "Use manual verified snapshots until an official source is activated.",
      }, 503);
    }

    await fuelPrices.activateDue();
    const fetched = await fetchReferencePrice({ sourceUrl: source.origin });
    if (!fetched.ok) {
      return ok({ outcome: "retained", reason: fetched.reason, persisted: false });
    }

    let parsed;
    try {
      parsed = parseOfficialReference(fetched.data, source);
    } catch (e) {
      return ok({ outcome: "retained", reason: e.message, persisted: false });
    }

    try {
      const result = await fuelPrices.record(parsed, { automatic: true });
      return ok({ outcome: result.duplicate ? "duplicate" : "recorded", snapshot: result.snapshot, persisted: !result.duplicate, source_id: source.id });
    } catch (error) {
      if ([400, 409].includes(error.status)) return ok({ outcome: "retained", reason: error.message, persisted: false, source_id: source.id });
      throw error;
    }
  } catch (e) {
    return handleError(fuelSchemaError(e));
  }
}
