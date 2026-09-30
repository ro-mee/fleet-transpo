import { withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { writeAuditRequired } from "@/lib/audit";
import {
  LICENSE_VERIFICATION_METHODS,
  validateLicenseDetails,
} from "@/lib/drivers/license-eligibility";

export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "drivers", "update");
    const id = (await params).id;
    const body = await parseBody(req);
    if (body?.confirm !== true) return err("Confirm that you checked the license details before recording verification.", 400);
    if (!LICENSE_VERIFICATION_METHODS.includes(body?.method)) {
      return err("Choose whether you checked the physical card or the LTO Digital ID.", 400);
    }

    const verified = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT license_number, license_type, license_class,
                license_expiry::text AS license_expiry
           FROM drivers WHERE driver_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      const driver = rows[0];
      if (!driver) return null;

      const errors = validateLicenseDetails(driver, { requireAll: true });
      if (Object.keys(errors).length) return { errors };

      const employeeId = session?.user?.employeeId ?? null;
      if (!employeeId) return { error: "Could not identify the staff member recording this verification." };
      const { rows: updated } = await tx.query(
        `UPDATE drivers
            SET license_verified_at = NOW(), license_verified_by = $2,
                license_verification_method = $3, updated_at = NOW()
          WHERE driver_id = $1
          RETURNING license_verified_at, license_verified_by, license_verification_method`,
        [id, employeeId, body.method]
      );
      if (!updated[0]) return null;
      await writeAuditRequired(tx, req, session, {
        action: "verify",
        resource: "drivers",
        resourceId: Number(id),
        newValues: { verification_method: updated[0].license_verification_method, outcome: "verified" },
      });
      return updated[0];
    });

    if (!verified) return err("Driver not found", 404);
    if (verified.errors) return err("License details must be complete and valid before verification.", 400);
    if (verified.error) return err(verified.error, 400);

    return ok({
      license_verified_at: verified.license_verified_at,
      license_verified_by: verified.license_verified_by,
      license_verification_method: verified.license_verification_method,
    });
  } catch (e) {
    return handleError(e);
  }
}
