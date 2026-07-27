import { createClient } from "@/lib/supabase/client";

export async function getAiRecommendations(type) {
  const supabase = createClient();
  let query = supabase
    .from("ai_recommendations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (type) query = query.eq("recommendation_type", type);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getAiInsights() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .select("*")
    .eq("status", "Active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createAiInsight(insight) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .insert(insight)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function dismissAiInsight(id) {
  const supabase = createClient();
  const { error } = await supabase
    .from("ai_insights")
    .update({ status: "Dismissed", is_read: true })
    .eq("insight_id", id);
  if (error) throw error;
}

export async function getPredictiveMaintenance() {
  const supabase = createClient();
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("vehicle_id, plate_number, vehicle_name, mileage, next_service_date, last_service_date, vehicle_status, fuel_type")
    .is("deleted_at", null);

  if (error) throw error;

  return (vehicles || []).map((v) => {
    const daysToService = v.next_service_date
      ? Math.max(0, Math.round((new Date(v.next_service_date) - new Date()) / (1000 * 60 * 60 * 24)))
      : 999;

    let risk = "low";
    let score = 100;

    if (daysToService <= 0) { risk = "overdue"; score = 0; }
    else if (daysToService <= 7) { risk = "critical"; score = 25; }
    else if (daysToService <= 30) { risk = "high"; score = 50; }
    else if (daysToService <= 60) { risk = "medium"; score = 70; }
    else { risk = "low"; score = 95; }

    return {
      vehicle_id: v.vehicle_id,
      plate_number: v.plate_number,
      vehicle_name: v.vehicle_name,
      mileage: v.mileage,
      next_service_date: v.next_service_date,
      last_service_date: v.last_service_date,
      daysToService,
      risk,
      score,
      recommendation: risk === "overdue" ? "Service overdue — schedule immediately"
        : risk === "critical" ? "Schedule service within 7 days"
        : risk === "high" ? "Plan service within 30 days"
        : risk === "medium" ? "Monitor — service due in 2 months"
        : "On track — next service in good time",
    };
  }).sort((a, b) => a.daysToService - b.daysToService);
}

export async function getAvailableVehiclesForReservation(reservationData) {
  const supabase = createClient();
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("*, vehiclecategories(*)")
    .eq("vehicle_status", "Available")
    .is("deleted_at", null);

  if (error) throw error;

  const passengerCount = reservationData.passenger_count || 1;
  const suitable = vehicles.filter((v) => v.seating_capacity >= passengerCount);

  return suitable.map((v) => {
    let score = 50;
    const reasons = [];

    if (v.seating_capacity >= passengerCount + 2) {
      score += 15;
      reasons.push("Extra capacity available");
    }
    if (v.fuel_level > 50) {
      score += 10;
      reasons.push("Sufficient fuel level");
    }
    if (v.mileage < 50000) {
      score += 10;
      reasons.push("Low mileage vehicle");
    }
    if (v.next_service_date && new Date(v.next_service_date) > new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) {
      score += 10;
      reasons.push("No upcoming service due");
    }

    return {
      vehicle: v,
      score: Math.min(score, 100),
      confidence: score / 100,
      reasons,
    };
  }).sort((a, b) => b.score - a.score);
}

export async function getAvailableDriversForDispatch(dispatchData) {
  const supabase = createClient();
  const { data: drivers, error } = await supabase
    .from("drivers")
    .select("*, employees(*)")
    .eq("driver_status", "Available");

  if (error) throw error;

  const driverIds = (drivers || []).map((d) => d.driver_id);
  const statsMap = {};
  if (driverIds.length > 0) {
    const { data: stats } = await supabase
      .from("driver_stats")
      .select("*")
      .in("driver_id", driverIds);
    (stats || []).forEach((s) => { statsMap[s.driver_id] = s; });
  }

  return (drivers || []).map((d) => {
    const s = statsMap[d.driver_id] || {};
    let score = 50;
    const reasons = [];

    if (s.performance_score > 4) {
      score += 20;
      reasons.push("High performer");
    }
    if (s.total_trips > 50) {
      score += 15;
      reasons.push("Experienced driver");
    }
    if (d.license_expiry && new Date(d.license_expiry) > new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)) {
      score += 10;
      reasons.push("License valid long-term");
    }
    if (d.years_of_experience > 3) {
      score += 10;
      reasons.push(`${d.years_of_experience}+ years experience`);
    }

    return {
      driver: d,
      score: Math.min(score, 100),
      confidence: score / 100,
      reasons,
    };
  }).sort((a, b) => b.score - a.score);
}
