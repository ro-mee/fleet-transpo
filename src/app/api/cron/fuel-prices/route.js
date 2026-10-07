import { ok, err, handleError } from "@/lib/api/utils";
import { verifyServiceToken } from "@/lib/api/service-auth";
import {
  fetchReferencePrice,
  parseOfficialReference,
} from "@/lib/fuel/providers/official-reference";
import { validateSnapshotInput } from "@/lib/fuel/price-policy";

// Official price-provider sync (Release D Task 12).
//
// Authentication is the shared CRON_SECRET (verifyServiceToken), never a user
// session — same convention as /api/cron/sync. Fail-closed when unset.
//
// ACTIVATION GATE: no official machine-readable, legally usable source has
// been identified, so the scheduler stays DISABLED and manual verified
// snapshots are the only source. The route answers 503 with that fact unless
// FUEL_PRICE_PROVIDER_ENABLED=1 with an https FUEL_PRICE_SOURCE_URL. Even
// when enabled, the route only validates into a Pending payload — it never
// persists (persistence lands with the Task 10 repository at the apply
// checkpoint) and it never runs inside request/dispatch paths.

function activation() {
  if (process.env.FUEL_PRICE_PROVIDER_ENABLED !== "1") return null;
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

    const validated = validateSnapshotInput({
      ...parsed,
      verification_method: "Automatic",
      source_hash: `fetch:${source.id}:${parsed.source_url}`,
      lifecycle: "Pending",
    });
    if (!validated.ok) {
      return ok({ outcome: "retained", reason: "Announcement failed snapshot validation; last verified snapshot retained.", persisted: false });
    }
    return ok({ outcome: "validated-pending", snapshot: validated.value, persisted: false });
  } catch (e) {
    return handleError(e);
  }
}
