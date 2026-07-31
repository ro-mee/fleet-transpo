import { query, getAdminClient } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const { searchParams } = new URL(req.url);

    let sql = `
      SELECT 
        d.*,
        json_build_object(
          'employee_id', e.employee_id,
          'first_name', e.first_name,
          'last_name', e.last_name,
          'email', e.email,
          'phone', e.phone,
          'position', e.position,
          'avatar_url', e.avatar_url
        ) AS employees
      FROM drivers d
      LEFT JOIN employees e ON d.employee_id = e.employee_id
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

    sql += ` ORDER BY d.created_at DESC`;

    const { rows: data } = await query(sql, params);
    if (!data || !data.length) return ok([]);

    return ok(data);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
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
    } = body;

    // Validate required fields
    if (!first_name?.trim() || !last_name?.trim()) {
      return err("first_name and last_name are required", 400);
    }
    if (!license_number?.trim()) {
      return err("license_number is required", 400);
    }

    const supabase = getAdminClient();

    // Auto-generate placeholder email if none provided
    const empEmail =
      email?.trim() ||
      `${first_name.trim().toLowerCase()}.${last_name.trim().toLowerCase()}@fleetops.ph`;

    // Step 1: Check if active employee already exists with this email
    const { data: existingEmp } = await supabase
      .from("employees")
      .select("employee_id")
      .eq("email", empEmail.toLowerCase())
      .is("deleted_at", null)
      .maybeSingle();

    let employeeId;
    let createdNewEmployee = false;

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
    } else {
      // Create new Employee record via Supabase Client
      const { data: newEmp, error: empError } = await supabase
        .from("employees")
        .insert({
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          email: empEmail.toLowerCase(),
          phone: phone?.trim() || null,
          position: position || "Driver",
          avatar_url: license_image_url || null,
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

    // Step 2: Create Driver record linked to employeeId via Supabase Client
    const { data: newDriver, error: driverError } = await supabase
      .from("drivers")
      .insert({
        employee_id: employeeId,
        license_number: license_number.trim(),
        license_expiry: license_expiry || null,
        license_type: license_type || null,
        license_class: license_class || null,
        years_of_experience: years_of_experience ? Number(years_of_experience) : 0,
        driver_status: driver_status || "Available",
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
        json_build_object(
          'employee_id', e.employee_id,
          'first_name', e.first_name,
          'last_name', e.last_name,
          'email', e.email,
          'phone', e.phone,
          'position', e.position,
          'avatar_url', e.avatar_url
        ) AS employees
      FROM drivers d
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      WHERE d.driver_id = $1
      LIMIT 1
    `;

    const { rows: fullRows } = await query(fetchSql, [driverId]);
    return ok(fullRows[0] || { driver_id: driverId, employee_id: employeeId }, 201);
  } catch (e) {
    return handleError(e);
  }
}
