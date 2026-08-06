import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";

/**
 * Rule-Based AI Engine
 * Deterministic business logic operating with ZERO external API keys.
 * Acts as the default engine & instant fallback if LLM Mode is unavailable.
 */

// 1. Reservation Vehicle Scoring
export function scoreReservationVehicles(vehicles = [], passengerCount = 1) {
  return vehicles
    .filter((v) => (v.seating_capacity || 4) >= passengerCount)
    .map((v) => {
      let score = 50;
      const reasons = [];

      // Capacity fit
      if (v.seating_capacity >= passengerCount && v.seating_capacity <= passengerCount + 4) {
        score += 25;
        reasons.push(`Ideal seating capacity (${v.seating_capacity} seats)`);
      } else if (v.seating_capacity > passengerCount + 4) {
        score += 10;
        reasons.push(`Ample extra seating (${v.seating_capacity} seats)`);
      }

      // Fuel level
      if ((v.fuel_level || 0) >= 70) {
        score += 15;
        reasons.push(`High fuel level (${v.fuel_level}%)`);
      } else if ((v.fuel_level || 0) >= 40) {
        score += 5;
        reasons.push(`Adequate fuel (${v.fuel_level}%)`);
      }

      // Status & Mileage
      if (v.vehicle_status === "Available") {
        score += 10;
        reasons.push("Currently available");
      }

      return {
        vehicle: v,
        score: Math.min(score, 100),
        confidence: (Math.min(score, 100) / 100).toFixed(2),
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
    let score = 50;
    const reasons = [];

    // PRIMARY: Guest rating (customer_rating AVG from completed trips, 1–5 scale).
    // Worth up to 35 points — most important signal for guest experience.
    const guestRating = Number(d.avg_guest_rating);
    const tripCount   = Number(d.total_completed_trips) || 0;
    if (!Number.isNaN(guestRating) && guestRating > 0 && tripCount > 0) {
      if (guestRating >= 4.5) {
        score += 35;
        reasons.push(`Outstanding guest rating: ${guestRating.toFixed(1)}/5 across ${tripCount} trips`);
      } else if (guestRating >= 4.0) {
        score += 25;
        reasons.push(`High guest rating: ${guestRating.toFixed(1)}/5 (${tripCount} trips)`);
      } else if (guestRating >= 3.0) {
        score += 10;
        reasons.push(`Average guest rating: ${guestRating.toFixed(1)}/5 (${tripCount} trips)`);
      } else {
        score -= 10;
        reasons.push(`Low guest rating: ${guestRating.toFixed(1)}/5 — monitor performance`);
      }
    } else if (tripCount === 0) {
      // New driver with no trip history — neutral, no penalty.
      reasons.push("New driver — no guest ratings yet");
    }

    // SECONDARY: Smooth driving score (system-tracked, 0–100).
    // Worth up to 20 points.
    const drivingScore = Number(d.avg_driving_score);
    if (!Number.isNaN(drivingScore) && drivingScore > 0) {
      if (drivingScore >= 85) {
        score += 20;
        reasons.push(`Excellent driving score: ${drivingScore.toFixed(0)}/100`);
      } else if (drivingScore >= 70) {
        score += 10;
        reasons.push(`Good driving score: ${drivingScore.toFixed(0)}/100`);
      } else if (drivingScore < 50) {
        score -= 10;
        reasons.push(`Low driving score: ${drivingScore.toFixed(0)}/100`);
      }
    }

    // License validity
    if (d.license_expiry) {
      const daysToExpiry = Math.round((new Date(d.license_expiry).getTime() - now) / dayMs);
      if (daysToExpiry > 90) {
        score += 10;
        reasons.push("License valid long-term");
      } else if (daysToExpiry <= 30) {
        score -= 20;
        reasons.push("License expiring soon — renewal recommended");
      }
    }

    // Status
    if (d.driver_status === "Available") {
      score += 5;
      reasons.push("Ready for dispatch");
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
