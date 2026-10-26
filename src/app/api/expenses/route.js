import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";

const SORT_COLUMNS = { expense_date: "e.expense_date", amount: "e.amount", created_at: "e.created_at" };

export async function GET(req) {
  try {
    await requirePermission(req, "expenses", "read");
    
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || "1");
    const requestedPageSize = Number(url.searchParams.get("pageSize") || "10");
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(requestedPageSize) || requestedPageSize < 1) {
      return err("Page and page size must be positive whole numbers", 400);
    }
    const pageSize = Math.min(100, requestedPageSize);
    const sortKey = url.searchParams.get("sort");
    const sortColumn = Object.hasOwn(SORT_COLUMNS, sortKey) ? SORT_COLUMNS[sortKey] : null;
    const sortDirection = url.searchParams.get("sortDir")?.toLowerCase() === "asc" ? "ASC" : "DESC";
    const orderBy = sortColumn ? `${sortColumn} ${sortDirection} NULLS LAST, e.id DESC` : "e.created_at DESC, e.id DESC";
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search")?.trim().toLowerCase();
    
    let whereClauses = ["1=1"];
    let params = [];
    let paramIdx = 1;

    if (status) {
      whereClauses.push(`e.status = $${paramIdx++}`);
      params.push(status);
    }

    if (search) {
      whereClauses.push(`(
        LOWER(e.merchant_name) LIKE $${paramIdx} OR
        LOWER(e.category) LIKE $${paramIdx} OR
        LOWER(c.card_label) LIKE $${paramIdx} OR
        LOWER(emp.first_name || ' ' || emp.last_name) LIKE $${paramIdx} OR
        LOWER(v.plate_number) LIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereSql = whereClauses.join(" AND ");
    const offset = (page - 1) * pageSize;

    // We get total counts across all statuses for the tabs
    const { rows: countRows } = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE e.status = 'Pending') as pending,
        COUNT(*) FILTER (WHERE e.status = 'Approved') as approved,
        COUNT(*) FILTER (WHERE e.status = 'Rejected') as rejected,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'Approved' AND UPPER(TRIM(e.currency)) = 'PHP'), 0) as approved_cost,
        COUNT(*) FILTER (WHERE e.status = 'Approved' AND UPPER(TRIM(e.currency)) IS DISTINCT FROM 'PHP') as approved_other_currency
      FROM expense_records e
    `);

    // We get total count for pagination
    const { rows: filteredCountRows } = await query(`
      SELECT COUNT(*) as filtered_total
      FROM expense_records e
      LEFT JOIN drivers d ON d.driver_id = e.driver_id
      LEFT JOIN employees emp ON emp.employee_id = d.employee_id
      LEFT JOIN company_cards c ON c.id = e.company_card_id
      LEFT JOIN vehicles v ON v.vehicle_id = e.vehicle_id
      WHERE ${whereSql}
    `, params);

    const { rows } = await query(`
      SELECT 
        e.*,
        CASE WHEN d.driver_id IS NOT NULL THEN json_build_object('driver_id', d.driver_id) END as driver,
        CASE WHEN emp.employee_id IS NOT NULL THEN json_build_object(
          'employee_id', emp.employee_id, 'first_name', emp.first_name, 'last_name', emp.last_name
        ) END as employee,
        row_to_json(c.*) as company_card,
        row_to_json(v.*) as vehicle,
        row_to_json(t.*) as trip,
        CASE WHEN rev.employee_id IS NOT NULL THEN json_build_object(
          'employee_id', rev.employee_id, 'first_name', rev.first_name, 'last_name', rev.last_name
        ) END as reviewer
      FROM expense_records e
      LEFT JOIN drivers d ON d.driver_id = e.driver_id
      LEFT JOIN employees emp ON emp.employee_id = d.employee_id
      LEFT JOIN company_cards c ON c.id = e.company_card_id
      LEFT JOIN vehicles v ON v.vehicle_id = e.vehicle_id
      LEFT JOIN trips t ON t.trip_id = e.trip_id
      LEFT JOIN employees rev ON rev.employee_id = e.reviewed_by
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, pageSize, offset]);

    return ok({
      rows: rows.map(row => ({
        ...row,
        driver: { ...row.driver, employee: row.employee },
        reviewer: row.reviewer
      })),
      total: Number(filteredCountRows[0].filtered_total),
      counts: {
        total: Number(countRows[0].total),
        pending: Number(countRows[0].pending),
        approved: Number(countRows[0].approved),
        rejected: Number(countRows[0].rejected),
        approvedCost: Number(countRows[0].approved_cost),
        approvedOtherCurrency: Number(countRows[0].approved_other_currency || 0)
      }
    });

  } catch (error) {
    return handleError(error, "Failed to fetch expenses");
  }
}
