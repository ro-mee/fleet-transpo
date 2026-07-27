// Supabase Edge Function: AI Vehicle Recommendation
// Deploy with: supabase functions deploy ai-recommend-vehicle

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { reservation_id, passenger_count, pickup_location } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data: vehicles, error: vError } = await supabase
      .from("vehicles")
      .select("*, vehiclecategories(*)")
      .eq("vehicle_status", "Available")
      .is("deleted_at", null);

    if (vError) throw vError;

    const scored = vehicles
      .filter((v) => v.seating_capacity >= (passenger_count || 1))
      .map((v) => {
        let score = 50;
        const reasons = [];

        if (v.seating_capacity >= (passenger_count || 1) + 2) {
          score += 15;
          reasons.push("Extra capacity available");
        }
        if (v.fuel_level > 75) {
          score += 10;
          reasons.push("High fuel level");
        } else if (v.fuel_level > 50) {
          score += 5;
          reasons.push("Adequate fuel level");
        }
        if (v.mileage < 30000) {
          score += 10;
          reasons.push("Low mileage");
        } else if (v.mileage < 80000) {
          score += 5;
          reasons.push("Moderate mileage");
        }
        if (v.next_service_date) {
          const daysToService = Math.ceil(
            (new Date(v.next_service_date) - new Date()) / (1000 * 60 * 60 * 24)
          );
          if (daysToService > 30) {
            score += 10;
            reasons.push("No service due soon");
          } else if (daysToService > 7) {
            score += 5;
            reasons.push("Service due within month");
          }
        }
        if (v.vehiclecategories?.base_rate) {
          score += 5;
        }

        const confidence = Math.round((score / 100) * 100) / 100;

        return {
          vehicle_id: v.vehicle_id,
          plate_number: v.plate_number,
          vehicle_name: v.vehicle_name,
          category: v.vehiclecategories?.category_name,
          seating_capacity: v.seating_capacity,
          fuel_level: v.fuel_level,
          fuel_type: v.fuel_type,
          mileage: v.mileage,
          score: Math.min(score, 100),
          confidence: Math.min(confidence, 1),
          reasons: reasons.slice(0, 3),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    await supabase.from("ai_recommendations").insert({
      recommendation_type: "vehicle_recommendation",
      reference_type: "reservation",
      reference_id: reservation_id,
      recommendation_data: { recommendations: scored },
      confidence_score: scored[0]?.confidence || 0,
      explanation: scored[0]?.reasons?.join(", ") || "No suitable vehicles found",
    });

    return new Response(JSON.stringify({ recommendations: scored }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
