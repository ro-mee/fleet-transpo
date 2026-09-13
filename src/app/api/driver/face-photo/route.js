import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { isSafeRemoteMediaUrl } from "@/lib/security/remote-url";
import { validateBase64Image } from "@/lib/uploads/validator";
import { createAdminClient } from "@/lib/supabase/admin";
import { notificationRolesFor } from "@/lib/notifications/recipients";
import { query } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

// Effectively-permanent signed URL: the same convention as fuel receipts
// (storeFuelReceipt). drivers.face_image_url is rendered raw by the staff
// driver page and the mobile avatar, so a 1-hour URL (the incident-photo
// convention) would rot in the column within the hour.
const FACE_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10;

/**
 * POST /api/driver/face-photo
 *
 * Single-call self-service face/profile photo update (mirrors the
 * POST /api/driver/license-scan contract): the mobile app sends the
 * camera/gallery image as a base64 data URL, the server validates it,
 * stores it in the private `face-captures` bucket (migration 006), and
 * writes the URL to the driver's own `face_image_url` — the same column
 * that backs the profile avatar AND the attendance face-verification
 * reference photo, so one upload serves both.
 *
 * No AI gate (unlike license-scan): there is no face-detection infra in
 * the repo. Quality control is staff review via the notification below —
 * self-updates never land silently. A driver can only ever overwrite
 * their OWN row (driver_id from the session, never the body).
 *
 * Body: { file_url: <JPEG/PNG data URL, ≤5MB> }
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);

    const body = await parseBody(req);

    const errors = validateBody(body, {
      file_url: { required: true, label: "Face photo" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    // SSRF guard: only inline data URLs or fleet-storage hosts may be stored.
    if (!isSafeRemoteMediaUrl(body.file_url)) {
      return err("file_url must be the captured face photo.", 400);
    }

    const validation = validateBase64Image(body.file_url);
    if (validation.error) {
      return err(validation.error, 400);
    }

    const supabase = createAdminClient();
    const fileName = `${session.user.driverId}/${uuidv4()}.${validation.extension}`;

    const { error: uploadError } = await supabase.storage
      .from("face-captures")
      .upload(fileName, validation.buffer, {
        contentType: validation.contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase face photo upload error:", uploadError);
      return err("Failed to securely store face photo.", 500);
    }

    const { data: signedData, error: signedUrlError } = await supabase.storage
      .from("face-captures")
      .createSignedUrl(fileName, FACE_URL_TTL_SECONDS);

    if (signedUrlError || !signedData?.signedUrl) {
      console.error("Supabase face photo signed URL error:", signedUrlError);
      return err("Failed to generate URL for face photo.", 500);
    }

    await query(
      `UPDATE drivers SET face_image_url = $1, updated_at = NOW()
        WHERE driver_id = $2 AND deleted_at IS NULL`,
      [signedData.signedUrl, session.user.driverId]
    );

    notifyStaffOfFacePhotoUpdate(session.user.driverId).catch((e) =>
      console.warn("Face photo staff notification skipped:", e.message)
    );

    return ok(
      {
        ok: true,
        face_image_url: signedData.signedUrl,
        driver_id: session.user.driverId,
      },
      201
    );
  } catch (e) {
    return handleError(e, "Failed to upload face photo");
  }
}

async function notifyStaffOfFacePhotoUpdate(driverId) {
  const { rows } = await query(
    `SELECT e.first_name, e.last_name FROM drivers d
     JOIN employees e ON d.employee_id = e.employee_id
     WHERE d.driver_id = $1`,
    [driverId]
  );
  const name = rows[0]
    ? `${rows[0].first_name || ""} ${rows[0].last_name || ""}`.trim() || `Driver #${driverId}`
    : `Driver #${driverId}`;

  const title = "Driver Face Photo Updated";
  const message =
    `${name} self-uploaded a new profile photo via the mobile app. ` +
    `It is also the attendance face-verification reference — please eyeball it on the driver record.`;

  const staff = await query(
    `SELECT employee_id FROM employees
     WHERE role_id IN (SELECT role_id FROM roles WHERE role_name = ANY($1))
       AND deleted_at IS NULL
       AND role_id IS NOT NULL`,
    [notificationRolesFor("drivers", "update")]
  );
  if (!staff.rows.length) return;

  await query(
    `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
     SELECT u.employee_id, $2, $3, 'Info', 'driver', $4 FROM unnest($1::int[]) AS u(employee_id)`,
    [staff.rows.map((s) => s.employee_id), title, message, Number(driverId) || null]
  );

  const { sendPush } = await import("@/services/push.service");
  await sendPush({
    employeeIds: staff.rows.map((s) => s.employee_id),
    title,
    body: message.slice(0, 160),
    data: { reference_type: "driver", reference_id: String(driverId) },
  });
}
