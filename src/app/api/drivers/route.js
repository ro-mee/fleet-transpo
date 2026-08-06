import bcrypt from "bcryptjs";
import { query, getAdminClient } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail, normalizePhone, normalizeLicense } from "@/lib/validation/helpers";
import { ROLE_IDS } from "@/lib/constants";
import { loadDriverTravelContext, driverCanTravel } from "@/lib/uvvrp/uvvrp.service";

const EMPLOYEE_FIELDS = `json_build_object(
  'employee_id', e.employee_id,
  'first_name', e.first_name,
  'last_name', e.last_name,
  'email', e.email,
  'phone', e.phone,
  'position', e.position,
  'avatar_url', e.avatar_url
) AS employees`;

// Auto-ensure emergency contact and back license image columns exist in PostgreSQL
let migrationRan = false;
async function ensureDriverColumnsExist() {
  if (migrationRan) return;
  try {
    await query(`
      ALTER TABLE drivers 
      ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS emergency_contact_address TEXT,
      ADD COLUMN IF NOT EXISTS license_image_url TEXT,
      ADD COLUMN IF NOT EXISTS license_back_image_url TEXT;
    `);
    migrationRan = true;
  } catch (err) {
    console.warn("Driver table column check skipped:", err.message);
  }
}

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"]);
    await ensureDriverColumnsExist();

    const { searchParams } = new URL(req.url);

    const includeUnlinked = searchParams.get("includeUnlinked") === "1";

    // Drivers with a linked drivers row. includeUnlinked additionally surfaces
    // role-driver employees that have NO drivers row yet (e.g. accounts created
    // via the old Settings → Add User path), flagged requires_completion so an
    // admin can finalize them through POST /api/drivers/link.
    let sql = `
      SELECT
        d.driver_id,
        d.employee_id,
        d.license_number,
        d.license_expiry,
        d.license_type,
        d.license_class,
        d.years_of_experience,
        d.driver_status,
        d.current_latitude,
        d.current_longitude,
        d.last_location_update,
        d.face_image_url,
        d.created_at,
        d.updated_at,
        ${EMPLOYEE_FIELDS},
        json_build_object(
          'employee_id', e.employee_id,
          'email', e.email,
          'role', r.role_name,
          'has_password', e.password_hash IS NOT NULL
        ) AS account,
        FALSE AS requires_completion
      FROM drivers d
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      LEFT JOIN roles r ON r.role_id = e.role_id
      WHERE d.deleted_at IS NULL
    `;

    const params = [];
    let idx = 1;

    const status = searchParams.get("status");
    if (status && status !== "all") {
      sql += ` AND d.driver_status = $${idx++}`;
      params.push(status);
    }

    const licenseClass = searchParams.get("license_class");
    if (licenseClass && licenseClass !== "all") {
      sql += ` AND d.license_class = $${idx++}`;
      params.push(licenseClass);
    }

    const search = searchParams.get("search");
    if (search && search.trim() !== "") {
      sql += ` AND (
        e.first_name ILIKE $${idx} OR 
        e.last_name ILIKE $${idx} OR 
        e.email ILIKE $${idx} OR 
        e.phone ILIKE $${idx} OR 
        d.license_number ILIKE $${idx}
      )`;
      params.push(`%${search.trim()}%`);
      idx++;
    }

    // Time-window conflict exclusion: skip drivers already dispatched in the
    // requested slot. Same half-open overlap rule as the vehicles endpoint.
    const pickupAt = searchParams.get("pickup_at");
    const returnAt = searchParams.get("return_at");
    if (pickupAt) {
      const end = returnAt || pickupAt;
      sql += `
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules ds
          WHERE ds.driver_id = d.driver_id
            AND ds.deleted_at IS NULL
            AND ds.status = ANY(ARRAY['Scheduled','In Progress'])
            AND ds.scheduled_departure < $${idx++}::timestamptz
            AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $${idx++}::timestamptz
        )`;
      params.push(end, pickupAt);
    }

    if (includeUnlinked) {
      sql += `
        UNION ALL
        SELECT
          NULL::INTEGER AS driver_id,
          e.employee_id,
          NULL AS license_number,
          NULL AS license_expiry,
          NULL AS license_type,
          NULL AS license_class,
          0 AS years_of_experience,
          'Incomplete' AS driver_status,
          NULL AS current_latitude,
          NULL AS current_longitude,
          NULL AS last_location_update,
          NULL AS face_image_url,
          e.created_at,
          e.updated_at,
          ${EMPLOYEE_FIELDS},
          json_build_object(
            'employee_id', e.employee_id,
            'email', e.email,
            'role', r.role_name,
            'has_password', e.password_hash IS NOT NULL
          ) AS account,
          TRUE AS requires_completion
        FROM employees e
        LEFT JOIN roles r ON r.role_id = e.role_id
        WHERE e.deleted_at IS NULL
          AND e.role_id = $${idx++}
          AND NOT EXISTS (
            SELECT 1 FROM drivers d2
            WHERE d2.employee_id = e.employee_id AND d2.deleted_at IS NULL
          )
      `;
      params.push(ROLE_IDS.driver);
    }

    sql += ` ORDER BY created_at DESC`;

    const { rows: data } = await query(sql, params);
    if (!data || !data.length) return ok([]);

    // Travel-date, pair-coupled availability: when a pickup_at is given, hide a
    // driver whose license expires on/before that date OR whose active paired
    // vehicle cannot travel that date (coding, registration/insurance). The
    // time-window conflict filter above still applies; this is the travel-day
    // projection + pairing rule. Ignored when no pickup_at is provided, so the
    // drivers list page is unaffected.
    if (pickupAt) {
      const ctx = await loadDriverTravelContext(pickupAt);
      return ok(data.filter((d) => driverCanTravel(d, ctx)));
    }

    return ok(data);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    await ensureDriverColumnsExist();
    const body = await parseBody(req);

    const {
      first_name,
      last_name,
      email,
      phone,
      position,
      license_number,
      license_expiry,
      license_type,
      license_class,
      years_of_experience,
      driver_status,
      license_image_url,
      license_back_image_url,
      address,
      sex,
      birthdate,
      nationality,
      emergency_contact_name,
      emergency_contact_phone,
      emergency_contact_address,
      password,
    } = body;

    // Validate required fields
    const errors = validateBody(body, {
      first_name: { required: true, type: "name", label: "First name", maxLength: 100 },
      last_name: { required: true, type: "name", label: "Last name", maxLength: 100 },
      email: { type: "email", label: "Email" },
      phone: { type: "phone", label: "Phone" },
      license_number: { required: true, type: "license", label: "License number", maxLength: 30 },
      license_expiry: { type: "date", label: "License expiry" },
      years_of_experience: { type: "positiveNumber", integer: true, label: "Years of experience" },
      birthdate: { type: "date", label: "Birthdate" },
      sex: { maxLength: 20, label: "Sex" },
      nationality: { maxLength: 100, label: "Nationality" },
      address: { maxLength: 255, label: "Address" },
      password: { type: "password", label: "Password" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const supabase = getAdminClient();

    // Auto-generate placeholder email if none provided
    const empEmail =
      normalizeEmail(email) ||
      `${normalizeName(first_name).toLowerCase()}.${normalizeName(last_name).toLowerCase()}@fleetops.ph`;

    // Step 1: Check if active employee already exists with this email
    const { data: existingEmp } = await supabase
      .from("employees")
      .select("employee_id, role_id, password_hash")
      .eq("email", empEmail.toLowerCase())
      .is("deleted_at", null)
      .maybeSingle();

    let employeeId;
    let createdNewEmployee = false;
    let roleId = ROLE_IDS.driver;
    let passwordHash = null;

    // A password on a reused employee would be a silent credential change — the
    // same account-takeover path POST /api/auth/register blocks with a 409. Only
    // set credentials on a brand-new employee row.
    if (password && password.trim() !== "") {
      passwordHash = await bcrypt.hash(password, 10);
    }

    if (existingEmp) {
      employeeId = existingEmp.employee_id;

      // Check if a driver profile already exists for this employee
      const { data: existingDriver } = await supabase
        .from("drivers")
        .select("driver_id")
        .eq("employee_id", employeeId)
        .is("deleted_at", null)
        .maybeSingle();

      if (existingDriver) {
        return err(
          `A driver profile already exists for employee with email "${empEmail}".`,
          409
        );
      }

      // Never silently overwrite an existing account's credentials from this
      // endpoint. If the employee already has a role or password, the driver
      // profile can be created but a login must be configured explicitly.
      if (passwordHash && (existingEmp.role_id || existingEmp.password_hash)) {
        return err(
          `Employee "${empEmail}" already has login credentials. Create the driver profile without a password, then set or reset the login from the driver detail page.`,
          409
        );
      }
      if (existingEmp.role_id) {
        roleId = existingEmp.role_id;
      }
      if (existingEmp.password_hash) {
        passwordHash = null;
      }
    } else {
      // Create new Employee record via Supabase Client
      const { data: newEmp, error: empError } = await supabase
        .from("employees")
        .insert({
          first_name: normalizeName(first_name),
          last_name: normalizeName(last_name),
          email: normalizeEmail(empEmail),
          phone: normalizePhone(phone) || null,
          position: position || "Driver",
          avatar_url: license_image_url || null,
          role_id: roleId,
          password_hash: passwordHash,
        })
        .select("employee_id")
        .single();

      if (empError) {
        if (empError.code === "23505") {
          return err(
            `An employee with email "${empEmail}" already exists. Please provide a unique email.`,
            409
          );
        }
        return err(empError.message || "Failed to create employee record", 500);
      }

      if (!newEmp?.employee_id) {
        return err("Employee record was created but ID was not returned", 500);
      }

      employeeId = newEmp.employee_id;
      createdNewEmployee = true;
    }

    // Step 2: Create Driver record linked to employeeId with Emergency Contact & Back License Image
    const { data: newDriver, error: driverError } = await supabase
      .from("drivers")
      .insert({
        employee_id: employeeId,
        license_number: normalizeLicense(license_number),
        license_expiry: license_expiry || null,
        license_type: license_type || null,
        license_class: license_class || null,
        years_of_experience: years_of_experience ? Number(years_of_experience) : 0,
        driver_status: driver_status || "Available",
        address: address || null,
        sex: sex || null,
        birthdate: birthdate || null,
        nationality: nationality || null,
        license_image_url: license_image_url || null,
        license_back_image_url: license_back_image_url || null,
        emergency_contact_name: emergency_contact_name || null,
        emergency_contact_phone: emergency_contact_phone || null,
        emergency_contact_address: emergency_contact_address || null,
      })
      .select("driver_id")
      .single();

    if (driverError) {
      console.error("Driver insert error:", driverError);
      if (createdNewEmployee) {
        await supabase
          .from("employees")
          .update({ deleted_at: new Date().toISOString() })
          .eq("employee_id", employeeId);
      }
      return err(driverError.message || "Failed to create driver record", 500);
    }

    const driverId = newDriver?.driver_id;
    if (!driverId) {
      if (createdNewEmployee) {
        await supabase
          .from("employees")
          .update({ deleted_at: new Date().toISOString() })
          .eq("employee_id", employeeId);
      }
      return err("Failed to insert driver record", 500);
    }

    // Fetch full record via raw SQL query to guarantee clean response
    const fetchSql = `
      SELECT 
        d.*,
        ${EMPLOYEE_FIELDS},
        json_build_object(
          'employee_id', e.employee_id,
          'email', e.email,
          'role', r.role_name,
          'has_password', e.password_hash IS NOT NULL
        ) AS account
      FROM drivers d
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      LEFT JOIN roles r ON r.role_id = e.role_id
      WHERE d.driver_id = $1
      LIMIT 1
    `;

    const { rows } = await query(fetchSql, [driverId]);
    return ok(rows[0], 201);
  } catch (e) {
    return handleError(e);
  }
}
