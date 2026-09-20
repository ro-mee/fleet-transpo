import { ok } from "@/lib/api/utils";

/**
 * GET /api/health
 *
 * Platform health-check endpoint (HostForge Health stage and any load
 * balancer). Deliberately fixed-response and dependency-free:
 *
 * - No auth guard — the probe is unauthenticated by design. Registered in
 *   PUBLIC_METHOD_ALLOWLIST in scripts/verify-route-auth.mjs so the
 *   route-auth audit stays green.
 * - No database, no env reads — a health path that touches the database
 *   fails before migrations have run and turns a first deploy into an
 *   infrastructure-looking failure. Liveness ("is the container up and
 *   answering on its port?") is the only question this answers; readiness
 *   of the database is surfaced by the app's own authenticated surfaces.
 */
export async function GET() {
  return ok({ ok: true, service: "fleetops-web" });
}
