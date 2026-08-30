import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth } from "@/lib/api/utils";

export async function GET(request) {
  try {
    await requireAuth(request, ["admin", "system_admin", "fleet_manager", "finance"]);

    const { searchParams } = new URL(request.url);
    const monthStr = searchParams.get("month");
    
    // Default to current month in Asia/Manila if not provided
    let targetMonthStr = monthStr;
    if (!targetMonthStr) {
      const nowManila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
      const yyyy = nowManila.getFullYear();
      const mm = String(nowManila.getMonth() + 1).padStart(2, "0");
      targetMonthStr = `${yyyy}-${mm}`;
    }
    if (!/^\d{4}-\d{2}$/.test(targetMonthStr)) {
      return NextResponse.json({ error: "Invalid month parameter, expected YYYY-MM" }, { status: 400 });
    }

    // 1. Overall Fuel Overview
    const { rows: overviewRows } = await query(`
      SELECT 
        COALESCE(SUM(amount), 0) AS total_spend,
        COALESCE(SUM(liters), 0) AS total_liters,
        COUNT(fuel_record_id) AS verified_transactions
      FROM fuelrecords
      WHERE deleted_at IS NULL
        AND status IN ('Approved', 'Completed')
        AND fuel_date >= ($1 || '-01')::date
        AND fuel_date < (($1 || '-01')::date + interval '1 month')
    `, [targetMonthStr]);
    
    const overview = overviewRows[0];
    const totalSpend = Number(overview.total_spend);
    const totalLiters = Number(overview.total_liters);
    const verifiedCount = Number(overview.verified_transactions);
    const averagePricePerLiter = totalLiters > 0 ? totalSpend / totalLiters : null;

    // 2. Vehicle Analytics
    const { rows: vehicleRows } = await query(`
      WITH fuel_stats AS (
        SELECT 
          vehicle_id,
          COALESCE(SUM(amount), 0) AS vehicle_spend,
          COALESCE(SUM(liters), 0) AS vehicle_liters
        FROM fuelrecords
        WHERE deleted_at IS NULL
          AND status IN ('Approved', 'Completed')
          AND fuel_date >= ($1 || '-01')::date
          AND fuel_date < (($1 || '-01')::date + interval '1 month')
        GROUP BY vehicle_id
      ),
      trip_stats AS (
        SELECT 
          vehicle_id,
          COUNT(trip_id) AS completed_trips,
          COALESCE(SUM(distance), 0) AS distance_traveled
        FROM trips
        WHERE deleted_at IS NULL
          AND trip_status = 'Completed'
          AND end_time >= ($1 || '-01 00:00:00+08')::timestamptz
          AND end_time < (($1 || '-01 00:00:00+08')::timestamptz + interval '1 month')
        GROUP BY vehicle_id
      )
      SELECT 
        v.vehicle_id,
        v.plate_number,
        v.vehicle_name,
        v.fuel_efficiency_kmpl AS baseline_efficiency,
        COALESCE(f.vehicle_spend, 0) AS vehicle_spend,
        COALESCE(f.vehicle_liters, 0) AS vehicle_liters,
        COALESCE(t.completed_trips, 0) AS completed_trips,
        COALESCE(t.distance_traveled, 0) AS distance_traveled
      FROM vehicles v
      LEFT JOIN fuel_stats f ON v.vehicle_id = f.vehicle_id
      LEFT JOIN trip_stats t ON v.vehicle_id = t.vehicle_id
      WHERE (f.vehicle_liters > 0 OR t.completed_trips > 0)
      ORDER BY vehicle_spend DESC
    `, [targetMonthStr]);

    const vehicleAnalytics = vehicleRows.map(row => {
      const liters = Number(row.vehicle_liters);
      const distance = Number(row.distance_traveled);
      let estKmpl = null;
      // Insufficient data rule: Need at least 50km and some fuel to make an estimate
      if (liters > 0 && distance >= 50) {
        estKmpl = Number((distance / liters).toFixed(2));
      }
      
      return {
        ...row,
        vehicle_spend: Number(row.vehicle_spend),
        vehicle_liters: liters,
        completed_trips: Number(row.completed_trips),
        distance_traveled: distance,
        estimated_kmpl: estKmpl,
        baseline_efficiency: Number(row.baseline_efficiency)
      };
    });

    // 3. Exceptions / Needs Review
    // Includes only Pending transactions that require action.
    const { rows: exceptionRows } = await query(`
      SELECT 
        f.fuel_record_id,
        f.vehicle_id,
        v.plate_number,
        f.driver_id,
        f.amount,
        f.liters,
        f.fuel_date,
        f.flags,
        f.status,
        f.receipt_scan_data,
        f.station_name,
        f.receipt_url,
        f.fuel_type
      FROM fuelrecords f
      JOIN vehicles v ON f.vehicle_id = v.vehicle_id
      WHERE f.deleted_at IS NULL
        AND f.fuel_date >= ($1 || '-01')::date
        AND f.fuel_date < (($1 || '-01')::date + interval '1 month')
        AND f.status = 'Pending'
      ORDER BY f.fuel_date DESC
    `, [targetMonthStr]);

    const exceptions = exceptionRows.map(row => ({
      ...row,
      flags: row.flags || {},
      amount: Number(row.amount),
      liters: Number(row.liters)
    }));

    return NextResponse.json({
      overview: {
        total_spend: totalSpend,
        total_liters: totalLiters,
        verified_transactions: verifiedCount,
        average_price_per_liter: averagePricePerLiter
      },
      vehicles: vehicleAnalytics,
      exceptions
    });

  } catch (error) {
    console.error("Fuel Analytics API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
