/**
 * Level 3 measured efficiency (gates signed off 2026-10-19).
 *
 * A vehicle's rolling measured fuel efficiency — eligible verified receipts
 * over actual completed-trip distance — may outrank the configured profile in
 * `resolveVehicleEfficiency` once its gates pass. The caliber is the official
 * one from `src/lib/reports/fuel-consumption.js`: eligible fuel is non-deleted
 * Approved transactions plus legacy Completed transactions, distance is
 * completed-trip distance, and the Manila calendar bounds both. Keep the SQL
 * below in sync with that module's queries — this must not become a second
 * caliber.
 *
 * Gates (product decisions, recorded in the Level 3 measurement plan):
 * - window: trailing MEASURED_EFFICIENCY_WINDOW_DAYS Manila calendar days;
 * - at least MEASURED_EFFICIENCY_MIN_DISTANCE_KM of measured distance;
 * - at least MEASURED_EFFICIENCY_MIN_RECEIPTS verified receipts;
 * - a wide gap against the profile is a review flag, never a blocker.
 *
 * Consumers in async contexts attach the assessment onto the vehicle row as
 * `_measured_efficiency` (via `attachMeasuredEfficiency`); the sync resolver
 * in `@/lib/ai/rule-engine` reads that property. Traffic, road grade,
 * route class and per-driver segmentation of the full Level 3 vision need
 * data this system does not capture — that stays parked in the plan doc.
 */
import { query } from "@/lib/db";
import { manilaTrailingRange } from "@/lib/dates";

export const MEASURED_EFFICIENCY_WINDOW_DAYS = 90;
export const MEASURED_EFFICIENCY_MIN_DISTANCE_KM = 100;
export const MEASURED_EFFICIENCY_MIN_RECEIPTS = 3;
export const MEASURED_EFFICIENCY_MAX_PROFILE_GAP = 0.35;

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Apply the gates and the receipts-over-distance arithmetic to one vehicle's
 * window aggregates. Never throws on odd input — anything that fails a gate
 * is simply ineligible, and the caller falls back to the profile.
 */
export function assessMeasuredEfficiency({ distanceKm = 0, liters = 0, receipts = 0 } = {}, profileKmpl = null) {
  const distance = Number(distanceKm) || 0;
  const fuel = Number(liters) || 0;
  const count = Number(receipts) || 0;
  const profile = Number(profileKmpl);

  if (!(distance >= MEASURED_EFFICIENCY_MIN_DISTANCE_KM) || count < MEASURED_EFFICIENCY_MIN_RECEIPTS || !(fuel > 0)) {
    return {
      eligible: false,
      kmpl: null,
      distance_km: distance,
      liters: fuel,
      receipts: count,
      profile_gap_ratio: null,
      flags: [],
    };
  }

  const kmpl = round2(distance / fuel);
  const gap = Number.isFinite(profile) && profile > 0 ? Math.abs(kmpl - profile) / profile : null;
  return {
    eligible: true,
    kmpl,
    distance_km: distance,
    liters: fuel,
    receipts: count,
    profile_gap_ratio: gap,
    flags: gap !== null && gap > MEASURED_EFFICIENCY_MAX_PROFILE_GAP ? ["profile-gap-high"] : [],
  };
}

/**
 * Attach each vehicle's measured-efficiency assessment as
 * `_measured_efficiency` (null-equivalent vehicles are simply skipped by the
 * resolver's gates). Two grouped queries mirror the official report caliber,
 * restricted per vehicle over the trailing-window Manila day range.
 */
export async function attachMeasuredEfficiency(vehicles, { reference = new Date() } = {}) {
  const rows = (vehicles ?? []).filter(Boolean);
  const ids = [...new Set(rows.map((vehicle) => Number(vehicle.vehicle_id)).filter(Number.isInteger))];
  const range = manilaTrailingRange(MEASURED_EFFICIENCY_WINDOW_DAYS, reference);
  if (!ids.length || !range) return rows;

  const [receiptsResult, distanceResult] = await Promise.all([
    query(
      `SELECT fr.vehicle_id,
              COALESCE(SUM(fr.liters), 0) AS liters,
              COUNT(*)::int AS receipts
         FROM fuelrecords fr
        WHERE fr.vehicle_id = ANY($1::int[])
          AND fr.deleted_at IS NULL
          AND fr.status IN ('Approved', 'Completed')
          AND fr.fuel_date >= $2::date AND fr.fuel_date < ($3::date + 1)
        GROUP BY fr.vehicle_id`,
      [ids, range.from, range.to]
    ),
    query(
      `SELECT t.vehicle_id,
              COALESCE(SUM(t.distance), 0) AS km
         FROM trips t
        WHERE t.vehicle_id = ANY($1::int[])
          AND t.deleted_at IS NULL AND t.trip_status = 'Completed'
          AND t.end_time >= ($2::date::timestamp AT TIME ZONE 'Asia/Manila')
          AND t.end_time < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
        GROUP BY t.vehicle_id`,
      [ids, range.from, range.to]
    ),
  ]);

  const aggregates = new Map(ids.map((id) => [id, { distanceKm: 0, liters: 0, receipts: 0 }]));
  for (const row of receiptsResult.rows) {
    const entry = aggregates.get(Number(row.vehicle_id));
    if (entry) {
      entry.liters = Number(row.liters) || 0;
      entry.receipts = Number(row.receipts) || 0;
    }
  }
  for (const row of distanceResult.rows) {
    const entry = aggregates.get(Number(row.vehicle_id));
    if (entry) entry.distanceKm = Number(row.km) || 0;
  }

  for (const vehicle of rows) {
    const entry = aggregates.get(Number(vehicle.vehicle_id));
    if (!entry) continue;
    vehicle._measured_efficiency = assessMeasuredEfficiency(
      entry,
      Number(vehicle.fuel_efficiency_kmpl) || null
    );
  }
  return rows;
}
