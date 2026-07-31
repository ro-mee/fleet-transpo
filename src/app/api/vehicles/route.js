import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { searchParams } = new URL(req.url);

    let sql = `SELECT v.*, row_to_json(vc.*) as vehiclecategories
               FROM vehicles v
               LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
               WHERE v.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    const status = searchParams.get("status");
    if (status) { sql += ` AND v.vehicle_status = $${idx++}`; params.push(status); }

    const category_id = searchParams.get("category_id");
    if (category_id) { sql += ` AND v.category_id = $${idx++}`; params.push(+category_id); }

    const search = searchParams.get("search");
    if (search) {
      sql += ` AND (v.plate_number ILIKE $${idx} OR v.vehicle_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += " ORDER BY v.vehicle_id DESC";

    const page = parseInt(searchParams.get("page"));
    const pageSize = parseInt(searchParams.get("pageSize"));
    if (page && pageSize) {
      sql += ` LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(pageSize, (page - 1) * pageSize);
    }

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);

    // Separate documents array from vehicle attributes
    const { documents, ...vehicleData } = body;

    // Sanitize empty strings to null to prevent PostgreSQL "invalid input syntax for type date: ''"
    Object.keys(vehicleData).forEach((k) => {
      if (vehicleData[k] === "" || vehicleData[k] === undefined) {
        vehicleData[k] = null;
      }
    });

    const keys = Object.keys(vehicleData);
    const values = Object.values(vehicleData);
    const cols = keys.join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

    const { rows } = await query(
      `INSERT INTO vehicles (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    const newVehicle = rows[0];

    // Insert linked documents into vehicledocuments table
    if (Array.isArray(documents) && documents.length > 0 && newVehicle?.vehicle_id) {
      for (const doc of documents) {
        if (!doc.document_type || (!doc.file_url && !doc.expiry_date && !doc.document_number)) continue;
        try {
          await query(
            `INSERT INTO vehicledocuments (vehicle_id, document_type, document_number, file_url, expiry_date, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              newVehicle.vehicle_id,
              doc.document_type,
              doc.document_number?.trim() || null,
              doc.file_url || null,
              doc.expiry_date || null,
              doc.status || "Active",
            ]
          );
        } catch (docErr) {
          console.warn("Failed to insert vehicle document:", docErr);
        }
      }
    }

    return ok(newVehicle, 201);
  } catch (e) { return handleError(e); }
}
