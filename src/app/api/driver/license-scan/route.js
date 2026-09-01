import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { isSafeRemoteMediaUrl } from "@/lib/security/remote-url";
import { query } from "@/lib/db";
import { loadScanImage, scanDocumentWithGemini } from "@/lib/ai/gemini-document";
import { evaluateLicenseScan } from "@/lib/ai/license-scan-policy";
import { validateBase64Image } from "@/lib/uploads/validator";
import { createAdminClient } from "@/lib/supabase/admin";
import { rolesFor } from "@/lib/auth/permissions";
import { v4 as uuidv4 } from "uuid";

/**
 * POST /api/driver/license-scan
 *
 * Single-call self-service license update: Gemini reads the photo, verifies it
 * is genuinely an LTO license card, and on pass the scan is SAVED to the
 * driver's own record along with a future-dated expiry read off the front of
 * the card. Ops staff (system_admin/admin/fleet_manager) get an in-app
 * notification so self-updates never land silently.
 *
 * Fail-closed: anything that fails verification (not a card, unreadable,
 * Gemini unavailable) writes NOTHING to the database - the driver retakes.
 *
 * Body: { side: "front" | "back", file_url: <data URL or URL> }
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);

    const body = await parseBody(req);

    const errors = validateBody(body, {
      side: { required: true, type: "alphanumeric", label: "Side" },
      file_url: { required: true, label: "Scan image" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const side = String(body.side).toLowerCase();
    if (side !== "front" && side !== "back") {
      return err("side must be 'front' or 'back'", 400);
    }

    // SSRF guard: only inline data URLs or fleet-storage hosts may be fetched.
    if (!isSafeRemoteMediaUrl(body.file_url)) {
      return err("file_url must be the captured scan image.", 400);
    }

    const validation = validateBase64Image(body.file_url);
    if (validation.error) {
      return err(validation.error, 400);
    }

    let scanned = {};
    try {
      const { extractedData } = await scanDocumentWithGemini(
        validation.buffer,
        validation.contentType,
        side === "back" ? "Driver_License_Back" : "Driver_License"
      );
      scanned = extractedData;
    } catch (scanError) {
      console.warn("Gemini license scan unavailable:", scanError.message);
      return ok({
        side,
        ok: false,
        applied_license_expiry: null,
        extracted_data: {},
        confidence_scores: {},
        validation_issues: ["License scanning is temporarily unavailable. Please try again later."],
        driver_id: session.user.driverId,
      });
    }

    const verdict = evaluateLicenseScan(side, scanned);
    if (!verdict.pass) {
      return ok({
        side,
        ok: false,
        applied_license_expiry: null,
        extracted_data: {},
        confidence_scores: {},
        validation_issues: [verdict.validationIssue],
        driver_id: session.user.driverId,
      });
    }

    const imageColumn = side === "back" ? "license_back_image_url" : "license_image_url";
    
    // Upload image to Supabase
    const supabase = createAdminClient();
    const fileName = `${session.user.driverId}/${uuidv4()}.${validation.extension}`;
    
    const { error: uploadError } = await supabase.storage
      .from("driver-licenses")
      .upload(fileName, validation.buffer, {
        contentType: validation.contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase license upload error:", uploadError);
      return err("Failed to securely store license image.", 500);
    }

    const { data: publicUrlData } = supabase.storage
      .from("driver-licenses")
      .getPublicUrl(fileName);
      
    const imageUrl = publicUrlData?.publicUrl;

    if (!imageUrl) {
      return err("Failed to generate URL for license image.", 500);
    }

    const setClauses = [`${imageColumn} = $1`, "updated_at = NOW()"];
    const params = [imageUrl];
    if (verdict.applyExpiry) {
      params.push(verdict.expiryDate);
      setClauses.push(`license_expiry = $${params.length}`);
    }
    params.push(session.user.driverId);

    await query(
      `UPDATE drivers SET ${setClauses.join(", ")} WHERE driver_id = $${params.length}`,
      params
    );

    delete scanned.document_is_license_card;

    notifyStaffOfLicenseUpdate(session.user.driverId, side, verdict.expiryDate).catch((e) =>
      console.warn("License update staff notification skipped:", e.message)
    );

    return ok({
      side,
      ok: true,
      applied_license_expiry: verdict.applyExpiry ? verdict.expiryDate : null,
      extracted_data: scanned,
      confidence_scores: {},
      validation_issues: [],
      driver_id: session.user.driverId,
    });
  } catch (e) {
    return handleError(e);
  }
}

async function notifyStaffOfLicenseUpdate(driverId, side, expiryDate) {
  const { rows } = await query(
    `SELECT e.first_name, e.last_name FROM drivers d
     JOIN employees e ON d.employee_id = e.employee_id
     WHERE d.driver_id = $1`,
    [driverId]
  );
  const name = rows[0]
    ? `${rows[0].first_name || ""} ${rows[0].last_name || ""}`.trim() || `Driver #${driverId}`
    : `Driver #${driverId}`;

  const expiryNote = expiryDate ? ` New expiry on file: ${expiryDate}.` : "";
  const title = "Driver License Updated";
  const message = `${name} self-uploaded a new ${side} license scan via the mobile app.${expiryNote}`;

  const staff = await query(
    `SELECT employee_id FROM employees
     WHERE role_id IN (SELECT role_id FROM roles WHERE role_name = ANY($1))
       AND deleted_at IS NULL`,
    [rolesFor("drivers", "update")]
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
