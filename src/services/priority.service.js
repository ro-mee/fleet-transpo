import { query } from "@/lib/db";
import { derivePriority } from "@/lib/scheduling/priority";
import { getDispatchPolicy } from "@/services/dispatch-settings.service";

/**
 * Recompute + persist derived_priority for one or more requests.
 *
 * The priority engine (src/lib/scheduling/priority.js) is pure; this is the
 * DB-boundary counterpart that reads the request's current columns and the
 * dispatch_policy thresholds, derives the level, and writes it back so the
 * queue can ORDER BY it in a single pass.
 *
 * @param {object|object[]} requests one request row or many
 * @param {object} [policy] optional preloaded policy (avoids a lookup per call)
 * @returns {Promise<Map<number,string|null>>} request_id -> derived level
 */
export async function recomputeDerivedPriority(requests, policy) {
  const list = Array.isArray(requests) ? requests : [requests];
  if (!list.length) return new Map();

  const active = list.filter((r) => r && r.request_id != null);
  if (!active.length) return new Map();

  const cfg = policy || (await getDispatchPolicy());
  const thresholds = {
    criticalMinutes: cfg.criticalMinutes,
    highMinutes: cfg.highMinutes,
    mediumMinutes: cfg.mediumMinutes,
  };

  const result = new Map();
  for (const r of active) {
    const level = derivePriority({
      pickupDatetime: r.pickup_datetime,
      fleetStatus: r.fleet_status,
      isVip: r.is_vip === true,
      isEmergency: r.is_emergency === true,
      thresholds,
    });
    result.set(r.request_id, level);
  }

  const params = [];
  for (const [id, level] of result) {
    params.push({ id, level });
  }

  // One batched UPSERT via unnest: arrays are passed as parameters, and the
  // terminal (null) levels are persisted too so stale stored priorities don't
  // linger after a request is completed/cancelled.
  await query(
    `UPDATE transportation_requests tr
        SET derived_priority = u.level, updated_at = NOW()
       FROM (SELECT * FROM unnest(
               $1::int[],
               $2::varchar[]
             ) AS t(request_id, level)
       ) u
      WHERE tr.request_id = u.request_id`,
    [
      params.map((p) => p.id),
      params.map((p) => p.level),
    ]
  );

  return result;
}
