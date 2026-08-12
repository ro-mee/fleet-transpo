import { apiFetch, buildQuery } from "@/lib/api/client";

// Provider Management
export async function getAiProviders() {
  return apiFetch("/api/ai/providers");
}

export async function createAiProvider(provider) {
  return apiFetch("/api/ai/providers", { method: "POST", body: provider });
}

export async function updateAiProvider(id, provider) {
  return apiFetch(`/api/ai/providers/${id}`, { method: "PUT", body: provider });
}

export async function deleteAiProvider(id) {
  return apiFetch(`/api/ai/providers/${id}`, { method: "DELETE" });
}

export async function testAiProviderConnection(id) {
  return apiFetch(`/api/ai/providers/${id}`, { method: "POST" });
}

export async function fetchAiModels(payload) {
  return apiFetch("/api/ai/providers/fetch-models", { method: "POST", body: payload });
}

// AI Request Logs
export async function getAiLogs(filters = {}) {
  return apiFetch(`/api/ai/logs${buildQuery(filters)}`);
}

// AI Recommendations & Insights
export async function getAiRecommendations(type = "reservation", params = {}) {
  return apiFetch(`/api/ai/recommendations${buildQuery({ type, ...params })}`);
}

// Report & analytics AI analyst narrative
export async function getReportNarrative(report, data, range = null, force = false) {
  return apiFetch("/api/ai/report-narrative", { method: "POST", body: { report, data, range, force } });
}

export async function getAiInsights(force = false) {
  const url = force ? `/api/ai/insights?force=true&t=${Date.now()}` : "/api/ai/insights";
  return apiFetch(url);
}

export async function createAiInsight(insight) {
  return apiFetch("/api/ai/insights", { method: "POST", body: insight });
}

export async function dismissAiInsight(id) {
  return apiFetch(`/api/ai/insights/${id}/dismiss`, { method: "PUT" });
}

// Predictive Maintenance
// Scoring lives in src/lib/ai/predictive-maintenance.js and runs server-side.
// Returns { predictions, summary } — summary carries precomputed band counts so
// pages read one number per stat card instead of re-filtering the array.
export async function getPredictiveMaintenance() {
  return apiFetch("/api/ai/predictive-maintenance");
}

// OCR Document Scanner
export async function scanDocumentWithAi(payload) {
  return apiFetch("/api/ai/scan-document", { method: "POST", body: payload });
}

// Reservations & Dispatch AI Recommendations Helpers
export async function getAvailableVehiclesForReservation(reservationData = {}) {
  const vehicles = await apiFetch(`/api/vehicles/available`);
  const passengerCount = reservationData.passenger_count || 1;
  const suitable = (vehicles || []).filter((v) => (v.seating_capacity || 4) >= passengerCount);
  return suitable.map((v) => {
    let score = 50; const reasons = [];
    if (v.seating_capacity >= passengerCount + 2) { score += 15; reasons.push("Extra capacity available"); }
    if ((v.fuel_level || 0) > 50) { score += 10; reasons.push("Sufficient fuel level"); }
    if ((v.mileage || 0) < 50000) { score += 10; reasons.push("Low mileage vehicle"); }
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
