import { query, withTransaction } from "@/lib/db";
import { AuthError, requirePermission, ok, handleError } from "@/lib/api/utils";
import { maskLicenseNumber } from "@/lib/drivers/license-eligibility";
import { writeAuditRequired } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

function daysUntil(date) {
  if (!date) return null;
  const d = new Date(date);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

export async function GET(req) {
  try {
    const session = await requirePermission(req, "vehicles", "update");
    const viewLimit = await rateLimit(`license-view:expiring-documents:${session.user.employeeId}`, { limit: 10, windowMs: 60_000 });
    if (!viewLimit.allowed) throw new AuthError("License view limit reached. Try again later.", 429, "RATE_LIMITED");
    const { rows: vehicles } = await query(
      `SELECT vehicle_id, plate_number, vehicle_name, model, manufacturer,
              license_plate_expiry, insurance_expiry, registration_expiry
         FROM vehicles WHERE deleted_at IS NULL`
    );
    const { rows: docs } = await query(
      `SELECT vehicle_id, document_type, document_number, expiry_date, status
         FROM vehicledocuments WHERE deleted_at IS NULL`
    );
    const { rows: drivers } = await query(
      `SELECT d.driver_id, d.license_number, d.license_expiry, d.license_type,
              d.face_image_url, e.avatar_url,
              COALESCE(e.first_name,'') AS first_name, COALESCE(e.last_name,'') AS last_name
         FROM drivers d
         LEFT JOIN employees e ON d.employee_id = e.employee_id
        WHERE d.deleted_at IS NULL`
    );

    const items = [];
    drivers.forEach((dr) => {
      if (!dr.license_expiry) return;
      items.push({
        driver_id: dr.driver_id,
        plate_number: null,
        vehicle: `${dr.first_name} ${dr.last_name}`.trim() || "Unknown Driver",
        face_image_url: dr.face_image_url || null,
        avatar_url: dr.avatar_url || null,
        document_type: "Driver License",
        document_number: maskLicenseNumber(dr.license_number),
        expiry_date: dr.license_expiry,
        days_left: daysUntil(dr.license_expiry),
        status: "driver",
        kind: "driver",
      });
    });
    vehicles.forEach((v) => {
      const pairs = [
        { kind: "License Plate", date: v.license_plate_expiry },
        { kind: "Insurance", date: v.insurance_expiry },
        { kind: "Registration", date: v.registration_expiry },
      ];
      pairs.forEach((p) => {
        if (!p.date) return;
        items.push({
          vehicle_id: v.vehicle_id,
          plate_number: v.plate_number,
          vehicle: `${v.manufacturer || ""} ${v.model || ""} ${v.vehicle_name || ""}`.trim(),
          document_type: p.kind,
          document_number: null,
          expiry_date: p.date,
          days_left: daysUntil(p.date),
          status: v.registration_expiry && p.kind === "Registration" ? "registration" : "vehicle",
        });
      });
      docs.forEach((d) => {
        if (d.vehicle_id !== v.vehicle_id || !d.expiry_date) return;
        items.push({
          vehicle_id: v.vehicle_id,
          plate_number: v.plate_number,
          vehicle: `${v.manufacturer || ""} ${v.model || ""} ${v.vehicle_name || ""}`.trim(),
          document_type: d.document_type,
          document_number: d.document_number,
          expiry_date: d.expiry_date,
          days_left: daysUntil(d.expiry_date),
          status: d.status || "document",
        });
      });
    });

    const expiring30 = items.filter((i) => i.days_left != null && i.days_left >= 0 && i.days_left <= 30);
    const expiring90 = items.filter((i) => i.days_left != null && i.days_left > 30 && i.days_left <= 90);
    const expired = items.filter((i) => i.days_left != null && i.days_left < 0);
    const sorted = [...items].sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9));

    const driverIds = [...new Set(items.filter((item) => item.kind === "driver").map((item) => item.driver_id))];
    if (driverIds.length) {
      await withTransaction((tx) => writeAuditRequired(tx, req, session, {
        action: "license_masked_viewed",
        resource: "drivers",
        resourceId: driverIds.length === 1 ? driverIds[0] : null,
        newValues: { driver_ids: driverIds.slice(0, 25), count: driverIds.length, source: "expiring_documents" },
      }));
    }

    return ok({ items: sorted, totals: { total: items.length, expired: expired.length, expiring30: expiring30.length, expiring90: expiring90.length } });
  } catch (e) { return handleError(e); }
}
