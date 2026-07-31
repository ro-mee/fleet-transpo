import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";

/**
 * Rule-Based AI Engine
 * Deterministic business logic operating with ZERO external API keys.
 * Acts as the default engine & instant fallback if LLM Mode is unavailable.
 */

// 1. Predictive Maintenance Calculation
export function calculatePredictiveMaintenance(vehicles = []) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  return vehicles.map((v) => {
    const daysToService = v.next_service_date
      ? Math.round((new Date(v.next_service_date).getTime() - now) / dayMs)
      : 999;

    let risk = "Low";
    let score = 95;
    const recommendations = [];

    if (daysToService <= 0) {
      risk = "Critical";
      score = 15;
      recommendations.push("Service OVERDUE — Ground vehicle for inspection immediately.");
    } else if (daysToService <= 7) {
      risk = "High";
      score = 40;
      recommendations.push("Service due within 7 days — Schedule preventive maintenance.");
    } else if (daysToService <= 30) {
      risk = "Medium";
      score = 70;
      recommendations.push("Service due within 30 days — Plan maintenance booking.");
    } else {
      risk = "Low";
      score = 95;
      recommendations.push("Vehicle in good operational standing.");
    }

    if (v.fuel_level < 25) {
      recommendations.push("Low fuel level alert — Refuel before next dispatch.");
    }

    return {
      vehicle_id: v.vehicle_id,
      plate_number: v.plate_number,
      vehicle_name: v.vehicle_name,
      mileage: v.mileage || 0,
      next_service_date: v.next_service_date,
      daysToService,
      risk,
      score,
      recommendations,
    };
  }).sort((a, b) => a.daysToService - b.daysToService);
}

// 2. Reservation Vehicle Scoring
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

// 3. Dispatch Driver Scoring
export function scoreDispatchDrivers(drivers = []) {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  return drivers.map((d) => {
    let score = 50;
    const reasons = [];

    // Experience
    if ((d.years_of_experience || 0) >= 3) {
      score += 20;
      reasons.push(`${d.years_of_experience}+ years driving experience`);
    }

    // License validity
    if (d.license_expiry) {
      const daysToExpiry = Math.round((new Date(d.license_expiry).getTime() - now) / dayMs);
      if (daysToExpiry > 90) {
        score += 20;
        reasons.push("Professional driver's license valid long-term");
      } else if (daysToExpiry <= 30) {
        score -= 20;
        reasons.push("License expiring soon — Renewal recommended");
      }
    }

    // Status
    if (d.driver_status === "Available") {
      score += 10;
      reasons.push("Ready for dispatch");
    }

    return {
      driver: d,
      score: Math.min(Math.max(score, 10), 100),
      confidence: (Math.min(Math.max(score, 10), 100) / 100).toFixed(2),
      reasons,
    };
  }).sort((a, b) => b.score - a.score);
}

// 4. Fleet & Dashboard Insights Generation
export function generateFleetInsights(vehicles = [], drivers = [], trips = []) {
  const insights = [];

  const totalVehicles = vehicles.length;
  const availableVehicles = vehicles.filter((v) => v.vehicle_status === "Available").length;
  const maintenanceVehicles = vehicles.filter((v) => v.vehicle_status === "Under Maintenance").length;

  if (totalVehicles > 0) {
    const availPct = Math.round((availableVehicles / totalVehicles) * 100);
    insights.push({
      title: "Fleet Availability",
      category: "Fleet Utilization",
      severity: availPct >= 70 ? "low" : "medium",
      summary: `Fleet operates at ${availPct}% active availability (${availableVehicles} of ${totalVehicles} vehicles ready for guest dispatch).`,
    });
  }

  if (maintenanceVehicles > 0) {
    insights.push({
      title: "Maintenance Grounding Alert",
      category: "Maintenance",
      severity: "high",
      summary: `${maintenanceVehicles} vehicle(s) currently grounded for maintenance. Ensure rapid turnaround for upcoming transfers.`,
    });
  }

  const expiringDrivers = drivers.filter((d) => {
    if (!d.license_expiry) return false;
    const days = Math.round((new Date(d.license_expiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return days <= 45;
  });

  if (expiringDrivers.length > 0) {
    insights.push({
      title: "Driver License Renewal Reminder",
      category: "Driver Compliance",
      severity: "medium",
      summary: `${expiringDrivers.length} driver(s) have license expiration dates approaching within 45 days. Coordinate renewal.`,
    });
  }

  // LTO Registration Renewal Alerts (Plate-Based Rules)
  vehicles.forEach((v) => {
    if (v.plate_number) {
      const sched = calculateLtoRenewalSchedule(v.plate_number);
      if (sched.success) {
        if (sched.status === "Overdue") {
          insights.push({
            title: `LTO Registration OVERDUE: ${v.plate_number}`,
            category: "LTO Compliance",
            severity: "high",
            summary: `Vehicle ${v.vehicle_name || v.plate_number} LTO registration renewal (${sched.formatted_window}) is OVERDUE! Ground or renew immediately.`,
          });
        } else if (sched.status === "Due This Week" || sched.status === "Due in 7 Days") {
          insights.push({
            title: `LTO Renewal Due This Week: ${v.plate_number}`,
            category: "LTO Compliance",
            severity: "high",
            summary: `Vehicle ${v.vehicle_name || v.plate_number} is scheduled for LTO registration renewal this week (${sched.formatted_window}).`,
          });
        } else if (sched.status === "Due in 14 Days" || sched.status === "Upcoming") {
          insights.push({
            title: `Upcoming LTO Registration Renewal: ${v.plate_number}`,
            category: "LTO Compliance",
            severity: "medium",
            summary: `Vehicle ${v.vehicle_name || v.plate_number} LTO renewal window is approaching on ${sched.formatted_window}.`,
          });
        }
      }
    }
  });

  return insights;
}
