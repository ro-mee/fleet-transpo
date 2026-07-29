import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getAiRecommendations(type) {
  return apiFetch(`/api/ai/recommendations${buildQuery({ type })}`);
}

export async function getAiInsights() {
  return apiFetch("/api/ai/insights");
}

export async function createAiInsight(insight) {
  return apiFetch("/api/ai/insights", { method: "POST", body: insight });
}

export async function dismissAiInsight(id) {
  return apiFetch(`/api/ai/insights/${id}/dismiss`, { method: "PUT" });
}

export async function getPredictiveMaintenance() {
  const vehicles = await apiFetch("/api/vehicles?limit=500");
  return (vehicles || []).map((v) => {
    const daysToService = v.next_service_date
      ? Math.max(0, Math.round((new Date(v.next_service_date) - new Date()) / (1000 * 60 * 60 * 24)))
      : 999;
    let risk = "low", score = 100;
    if (daysToService <= 0) { risk = "overdue"; score = 0; }
    else if (daysToService <= 7) { risk = "critical"; score = 25; }
    else if (daysToService <= 30) { risk = "high"; score = 50; }
    else if (daysToService <= 60) { risk = "medium"; score = 70; }
    return {
      vehicle_id: v.vehicle_id, plate_number: v.plate_number, vehicle_name: v.vehicle_name,
      mileage: v.mileage, next_service_date: v.next_service_date, last_service_date: v.last_service_date,
      daysToService, risk, score,
      recommendation: risk === "overdue" ? "Service overdue — schedule immediately"
        : risk === "critical" ? "Schedule service within 7 days"
        : risk === "high" ? "Plan service within 30 days"
        : risk === "medium" ? "Monitor — service due in 2 months"
        : "On track — next service in good time",
    };
  }).sort((a, b) => a.daysToService - b.daysToService);
}

export async function getAvailableVehiclesForReservation(reservationData) {
  const vehicles = await apiFetch(`/api/vehicles/available`);
  const passengerCount = reservationData.passenger_count || 1;
  const suitable = vehicles.filter((v) => v.seating_capacity >= passengerCount);
  return suitable.map((v) => {
    let score = 50; const reasons = [];
    if (v.seating_capacity >= passengerCount + 2) { score += 15; reasons.push("Extra capacity available"); }
    if (v.fuel_level > 50) { score += 10; reasons.push("Sufficient fuel level"); }
    if (v.mileage < 50000) { score += 10; reasons.push("Low mileage vehicle"); }
    if (v.next_service_date && new Date(v.next_service_date) > new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) { score += 10; reasons.push("No upcoming service due"); }
    return { vehicle: v, score: Math.min(score, 100), confidence: score / 100, reasons };
  }).sort((a, b) => b.score - a.score);
}

export async function getAvailableDriversForDispatch() {
  const drivers = await apiFetch("/api/drivers?status=Available");
  const driverIds = (drivers || []).map((d) => d.driver_id);
  const statsMap = {};
  if (driverIds.length > 0) {
    await Promise.all((drivers || []).map(async (d) => {
      try { const s = await apiFetch(`/api/drivers/${d.driver_id}`); statsMap[d.driver_id] = s; } catch {}
    }));
  }
  return (drivers || []).map((d) => {
    const s = statsMap[d.driver_id] || {};
    let score = 50; const reasons = [];
    if (s.performance_score > 4) { score += 20; reasons.push("High performer"); }
    if (s.total_trips > 50) { score += 15; reasons.push("Experienced driver"); }
    if (d.license_expiry && new Date(d.license_expiry) > new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)) { score += 10; reasons.push("License valid long-term"); }
    if (d.years_of_experience > 3) { score += 10; reasons.push(`${d.years_of_experience}+ years experience`); }
    return { driver: d, score: Math.min(score, 100), confidence: score / 100, reasons };
  }).sort((a, b) => b.score - a.score);
}
