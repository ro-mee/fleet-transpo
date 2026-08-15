import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";
import { RISK } from "@/lib/ai/predictive-maintenance";

/**
 * Rule-Based AI Engine
 * Deterministic business logic operating with ZERO external API keys.
 * Acts as the default engine & instant fallback if LLM Mode is unavailable.
 *
 * Smart Dispatch adds four decision-support signals on top of the legacy
 * capacity/fuel/status factors. Every helper is pure: the API route attaches
 * the raw data as `_`-prefixed attributes on each candidate row, and the
 * scorer turns them into points and reason strings. Nothing here queries a
 * database or reads the clock.
 */

/** Proximity only ranks drivers for IMMEDIATE dispatch. Future-dated pickups get no bonus. */
export function isProximityRelevant(pickupDatetime, now = new Date(), windowHrs = 3) {
  if (!pickupDatetime) return false;
  const t = new Date(pickupDatetime).getTime();
  const n = new Date(now).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return false;
  return t <= n + windowHrs * 60 * 60 * 1000;
}

/**
 * Fuel efficiency heuristic (km/L) inferred from seating capacity and fuel type.
 * Shared by the scoring and the payload so "estimated fuel" means one number.
 */
export function estimateEfficiency(vehicle) {
  const seats = Number(vehicle?.seating_capacity) || 4;
  let kmPerLiter;
  if (seats <= 5) kmPerLiter = 12;
  else if (seats <= 8) kmPerLiter = 9;
  else if (seats <= 15) kmPerLiter = 7;
  else kmPerLiter = 5;
  return /diesel/i.test(vehicle?.fuel_type || "") ? kmPerLiter * 1.15 : kmPerLiter;
}

function kmLabel(distanceKm) {
  return Number(distanceKm).toFixed(1);
}

/** Nearest driver. Absolute points; the caller decides when it applies. */
export function scoreProximity(distanceKm) {
  if (distanceKm === null || distanceKm === undefined) return { points: 0, reason: null };
  if (distanceKm <= 2) return { points: 12, reason: `Closest to pickup (${kmLabel(distanceKm)} km)` };
  if (distanceKm <= 5) return { points: 8, reason: `Near pickup (${kmLabel(distanceKm)} km)` };
  if (distanceKm <= 10) return { points: 4, reason: `${kmLabel(distanceKm)} km from pickup` };
  return { points: 0, reason: null };
}

/** Least fuel consumption for THIS trip. Absolute points; caller scales by weight. */
export function scoreFuelEconomy(estLiters) {
  if (estLiters === null || estLiters === undefined) return { points: 0, reason: null };
  if (estLiters <= 2) return { points: 15, reason: `Most fuel-efficient for this trip (~${estLiters} L)` };
  if (estLiters <= 4) return { points: 8, reason: `Fuel-efficient for this trip (~${estLiters} L)` };
  if (estLiters <= 7) return { points: 3, reason: `~${estLiters} L fuel for this trip` };
  return { points: 0, reason: null };
}

/**
 * Smallest schedule gap. Returns a 0..1 utilization gain; the caller scales by
 * its weight budget (vehicles and drivers carry different weights).
 */
export function scheduleGapGain(load) {
  if (load === null || load === undefined) return 0;
  const n = Number(load) || 0;
  if (n <= 0) return 1;
  if (n === 1) return 0.6;
  if (n === 2) return 0.25;
  return 0;
}

/**
 * A driver's recency-weighted workload index (AI Fair Workload Distribution).
 *
 * Combines the three workload dimensions the user cares about — trip count,
 * distance, and drive time — across a rolling lookback, giving more weight to
 * recent activity. This is the fairness input, NOT a hard rule: it only ranks
 * who SHOULD be recommended among already-eligible pairs.
 *
 * Units are folded onto the trip-count scale so a very distant/heavy trip does
 * not dwarf a busy week: distance is normalised by an assumed ~40 km per trip
 * and hours by ~1.5 h per trip. Recency weight: the last 7 days count 1.0 and
 * the last 30 days 0.4, so a driver busy this week reads heavier than one who
 * was busy three weeks ago.
 *
 * @param {object} w
 * @param {number} [w.trips7d] completed trips, last 7 days
 * @param {number} [w.trips30d] completed trips, last 30 days
 * @param {number} [w.km7d] completed distance (km), last 7 days
 * @param {number} [w.km30d] completed distance (km), last 30 days
 * @param {number} [w.hours7d] completed drive hours, last 7 days
 * @param {number} [w.hours30d] completed drive hours, last 30 days
 * @returns {number} 0 when there is no recorded history (neutral, never a penalty)
 */
export function workloadIndex(w) {
  const obj = w ?? {};
  const trips = (Number(obj.trips7d ?? obj.trips_7d) || 0) + 0.4 * (Number(obj.trips30d ?? obj.trips_30d) || 0);
  const km = (Number(obj.km7d ?? obj.km_7d) || 0) + 0.4 * (Number(obj.km30d ?? obj.km_30d) || 0);
  const hours = (Number(obj.hours7d ?? obj.hours_7d) || 0) + 0.4 * (Number(obj.hours30d ?? obj.hours_30d) || 0);
  if (trips <= 0 && km <= 0 && hours <= 0) return 0;
  return trips + km / 40 + hours / 1.5;
}

/**
 * Pool-relative workload fairness, 0..1 (higher = lighter load).
 *
 * The fairness score is defined against the OTHER candidates in the pool, not an
 * arbitrary absolute threshold: 1.0 means this driver is the least-loaded in the
 * eligible set ("lowest workload among eligible drivers"). A driver with no
 * history scores a neutral 0.5 — never rewarded for having no data, never
 * penalised for it.
 *
 * @param {number} index the driver's workloadIndex
 * @param {number} poolMax the max workloadIndex among the eligible candidates
 * @returns {number} 0..1
 */
export function scoreWorkloadBalance(index, poolMax) {
  const i = Number(index) || 0;
  const max = Number(poolMax) || 0;
  if (!(max > 0)) return 0.5;
  return Math.min(1, Math.max(0, 1 - i / max));
}

/**
 * Lowest maintenance risk, as a signed gain from -1.5 (overdue/critical) to 1
 * (low). Callers multiply by their weight budget. Unknown risk is a neutral 0.5
 * midpoint — never claimed healthy without a schedule.
 */
export function maintenanceRiskGain(risk) {
  if (!risk) return 0.5;
  switch (risk) {
    case RISK.LOW:
      return 1;
    case RISK.MEDIUM:
      return 0.5;
    case RISK.HIGH:
      return 0;
    case RISK.CRITICAL:
    case RISK.OVERDUE:
      return -1.5;
    default:
      return 0.5;
  }
}

// 1. Reservation Vehicle Scoring
export function scoreReservationVehicles(vehicles = [], passengerCount = 1) {
  return vehicles
    .filter((v) => (v.seating_capacity || 4) >= passengerCount)
    .map((v) => {
      let score = 30;
      const reasons = [];

      // Capacity fit
      if (v.seating_capacity >= passengerCount && v.seating_capacity <= passengerCount + 4) {
        score += 20;
        reasons.push(`Ideal seating capacity (${v.seating_capacity} seats)`);
      } else if (v.seating_capacity > passengerCount + 4) {
        score += 8;
        reasons.push(`Ample extra seating (${v.seating_capacity} seats)`);
      }

      // Fuel level (readiness — kept for future reservations too)
      if ((v.fuel_level || 0) >= 70) {
        score += 8;
        reasons.push(`High fuel level (${v.fuel_level}%)`);
      } else if ((v.fuel_level || 0) >= 40) {
        score += 3;
        reasons.push(`Adequate fuel (${v.fuel_level}%)`);
      }

      // Status
      if (v.vehicle_status === "Available") {
        score += 5;
        reasons.push("Currently available");
      }

      // Least fuel consumption (this trip)
      const fuel = scoreFuelEconomy(v._est_fuel_liters);
      score += fuel.points;
      if (fuel.reason) reasons.push(fuel.reason);

      // Smallest schedule gap
      const gap = scheduleGapGain(v._schedule_load) * 10;
      score += gap;
      if (v._schedule_load !== undefined && v._schedule_load !== null) {
        const load = Number(v._schedule_load) || 0;
        reasons.push(
          load <= 0 ? "No schedule conflicts in this window" : `${load} dispatch(es) scheduled in this window`
        );
      }

      // Lowest maintenance risk — only when a schedule is actually set.
      // An unscheduled vehicle is not known-healthy, so it scores neutral.
      const pm = v._maintenance;
      if (pm && pm.basis !== null && pm.basis !== undefined) {
        score += maintenanceRiskGain(pm.risk) * 10;
        const due = pm.effectiveDays !== null && pm.effectiveDays !== undefined ? ` (due in ~${pm.effectiveDays} day(s))` : "";
        reasons.push(`Service risk: ${pm.risk}${due}`);
      }

      return {
        vehicle: v,
        score: Math.min(Math.max(score, 0), 100),
        confidence: (Math.min(Math.max(score, 0), 100) / 100).toFixed(2),
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// 2. Dispatch Driver Scoring
// Primary signal: guest reviews (avg_guest_rating, 1–5 scale from customer_rating on trips).
// Secondary signal: smooth_driving_score (system-tracked driving behaviour).
// Years of experience is deliberately NOT used — a driver with one year and perfect
// guest reviews outperforms a 10-year veteran with poor ratings.
export function scoreDispatchDrivers(drivers = []) {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  return drivers.map((d) => {
    let score = 30;
    const reasons = [];

    // PRIMARY: Guest rating (customer_rating AVG from completed trips, 1–5 scale).
    const guestRating = Number(d.avg_guest_rating);
    const tripCount   = Number(d.total_completed_trips) || 0;
    if (!Number.isNaN(guestRating) && guestRating > 0 && tripCount > 0) {
      if (guestRating >= 4.5) {
        score += 25;
        reasons.push(`Outstanding guest rating: ${guestRating.toFixed(1)}/5 across ${tripCount} trips`);
      } else if (guestRating >= 4.0) {
        score += 18;
        reasons.push(`High guest rating: ${guestRating.toFixed(1)}/5 (${tripCount} trips)`);
      } else if (guestRating >= 3.0) {
        score += 8;
        reasons.push(`Average guest rating: ${guestRating.toFixed(1)}/5 (${tripCount} trips)`);
      } else {
        score -= 8;
        reasons.push(`Low guest rating: ${guestRating.toFixed(1)}/5 — monitor performance`);
      }
    } else if (tripCount === 0) {
      // New driver with no trip history — neutral, no penalty.
      reasons.push("New driver — no guest ratings yet");
    }

    // SECONDARY: Smooth driving score (system-tracked, 0–100).
    const drivingScore = Number(d.avg_driving_score);
    if (!Number.isNaN(drivingScore) && drivingScore > 0) {
      if (drivingScore >= 85) {
        score += 15;
        reasons.push(`Excellent driving score: ${drivingScore.toFixed(0)}/100`);
      } else if (drivingScore >= 70) {
        score += 8;
        reasons.push(`Good driving score: ${drivingScore.toFixed(0)}/100`);
      } else if (drivingScore < 50) {
        score -= 8;
        reasons.push(`Low driving score: ${drivingScore.toFixed(0)}/100`);
      }
    }

    // License validity
    if (d.license_expiry) {
      const daysToExpiry = Math.round((new Date(d.license_expiry).getTime() - now) / dayMs);
      if (daysToExpiry > 90) {
        score += 8;
        reasons.push("License valid long-term");
      } else if (daysToExpiry <= 30) {
        score -= 15;
        reasons.push("License expiring soon — renewal recommended");
      }
    }

    // Status
    if (d.driver_status === "Available") {
      score += 4;
      reasons.push("Ready for dispatch");
    }

    // Nearest driver — only for IMMEDIATE dispatch windows (time-gated).
    if (d._proximity_relevant !== false) {
      const prox = scoreProximity(d._pickup_distance_km);
      score += prox.points;
      if (prox.reason) reasons.push(prox.reason);
    }

    // Smallest schedule gap
    const gap = scheduleGapGain(d._schedule_load) * 8;
    score += gap;
    if (d._schedule_load !== undefined && d._schedule_load !== null) {
      const load = Number(d._schedule_load) || 0;
      reasons.push(
        load <= 0 ? "No schedule conflicts in this window" : `${load} dispatch(es) scheduled in this window`
      );
    }

    return {
      driver: d,
      avg_guest_rating:     d.avg_guest_rating ?? null,
      avg_driving_score:    d.avg_driving_score ?? null,
      total_completed_trips: tripCount,
      score: Math.min(Math.max(score, 10), 100),
      confidence: (Math.min(Math.max(score, 10), 100) / 100).toFixed(2),
      reasons,
    };
  }).sort((a, b) => b.score - a.score);
}

// 3. Fleet & Dashboard Insights Generation
function makeInsight(insight) {
  const id = insight.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return { insight_id: id, ...insight };
}

export function generateFleetInsights(vehicles = [], drivers = [], trips = []) {
  const insights = [];

  const totalVehicles = vehicles.length;
  const availableVehicles = vehicles.filter((v) => v.vehicle_status === "Available").length;
  const maintenanceVehicles = vehicles.filter((v) => v.vehicle_status === "Under Maintenance").length;

  if (totalVehicles > 0) {
    const availPct = Math.round((availableVehicles / totalVehicles) * 100);
    insights.push(makeInsight({
      title: "Fleet Availability",
      category: "Fleet Utilization",
      severity: availPct >= 70 ? "low" : "medium",
      summary: `Fleet operates at ${availPct}% active availability (${availableVehicles} of ${totalVehicles} vehicles ready for guest dispatch).`,
    }));
  }

  if (maintenanceVehicles > 0) {
    insights.push(makeInsight({
      title: "Maintenance Grounding Alert",
      category: "Maintenance",
      severity: "high",
      summary: `${maintenanceVehicles} vehicle(s) currently grounded for maintenance. Ensure rapid turnaround for upcoming transfers.`,
    }));
  }

  const expiringDrivers = drivers.filter((d) => {
    if (!d.license_expiry) return false;
    const days = Math.round((new Date(d.license_expiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return days <= 45;
  });

  if (expiringDrivers.length > 0) {
    insights.push(makeInsight({
      title: "Driver License Renewal Reminder",
      category: "Driver Compliance",
      severity: "medium",
      summary: `${expiringDrivers.length} driver(s) have license expiration dates approaching within 45 days. Coordinate renewal.`,
    }));
  }

  // LTO Registration Renewal Alerts (Plate-Based Rules)
  vehicles.forEach((v) => {
    if (v.plate_number) {
      const sched = calculateLtoRenewalSchedule(v.plate_number);
      if (sched.success) {
        if (sched.status === "Overdue") {
          insights.push(makeInsight({
            title: `LTO Registration OVERDUE: ${v.plate_number}`,
            category: "LTO Compliance",
            severity: "high",
            summary: `Vehicle ${v.vehicle_name || v.plate_number} LTO registration renewal (${sched.formatted_window}) is OVERDUE! Ground or renew immediately.`,
          }));
        } else if (sched.status === "Due This Week" || sched.status === "Due in 7 Days") {
          insights.push(makeInsight({
            title: `LTO Renewal Due This Week: ${v.plate_number}`,
            category: "LTO Compliance",
            severity: "high",
            summary: `Vehicle ${v.vehicle_name || v.plate_number} is scheduled for LTO registration renewal this week (${sched.formatted_window}).`,
          }));
        } else if (sched.status === "Due in 14 Days" || sched.status === "Upcoming") {
          insights.push(makeInsight({
            title: `Upcoming LTO Registration Renewal: ${v.plate_number}`,
            category: "LTO Compliance",
            severity: "medium",
            summary: `Vehicle ${v.vehicle_name || v.plate_number} LTO renewal window is approaching on ${sched.formatted_window}.`,
          }));
        }
      }
    }
  });

  return insights;
}
