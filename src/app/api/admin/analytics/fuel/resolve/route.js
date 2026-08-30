import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth, parseBody } from "@/lib/api/utils";

export async function POST(request) {
  try {
    const session = await requireAuth(request, ["admin", "system_admin", "fleet_manager", "finance"]);
    
    const body = await parseBody(request);
    const { fuel_record_id, status, review_remarks } = body;
    
    if (!fuel_record_id || !status) {
      return NextResponse.json({ error: "fuel_record_id and status are required" }, { status: 400 });
    }
    
    if (!["Approved", "Rejected"].includes(status)) {
      return NextResponse.json({ error: "Status must be Approved or Rejected" }, { status: 400 });
    }
    
    // We update the status and record who/when/remarks.
    // Notice that we DO NOT delete the `flags` column, preserving the historical anomaly evidence.
    const { rows } = await query(`
      UPDATE fuelrecords
      SET 
        status = $1,
        review_remarks = $2,
        approved_by = $3,
        approved_at = NOW(),
        updated_by = $3,
        updated_at = NOW()
      WHERE fuel_record_id = $4 AND deleted_at IS NULL AND status = 'Pending'
      RETURNING fuel_record_id, status
    `, [
      status,
      review_remarks || null,
      session.user.employeeId,
      fuel_record_id
    ]);
    
    if (rows.length === 0) {
      return NextResponse.json({ error: "Fuel record not found, already deleted, or already resolved" }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, record: rows[0] });
    
  } catch (error) {
    console.error("Fuel Resolve API Error:", error);
    if (error.status) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
