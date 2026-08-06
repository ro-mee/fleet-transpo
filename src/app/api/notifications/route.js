import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

export async function GET(req) {
  try {
    const session = await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT * FROM notifications`;
    const params = []; let idx = 1;
    const conditions = [];
    const own = session.user?.employeeId ?? session.user?.userId ?? null;
    const canScopeAll = ["system_admin", "admin", "fleet_manager"].includes(session.user?.role);
    const target = sp.get("employee_id");
    if (target) {
      if (!canScopeAll) return err("Not authorized to view another user's notifications", 403);
      conditions.push(`employee_id = $${idx++}`); params.push(+target);
    } else if (own) {
      // employee_id is int and user_id is uuid, so both cannot share one param
      // typed against one column: comparing the numeric employeeId to the uuid
      // user_id column makes Postgres throw a cast error and the self-scoped
      // read 500s. Scope on whichever identity is actually present.
      const isEmp = session.user?.employeeId != null;
      conditions.push(isEmp ? `employee_id = $${idx++}` : `user_id = $${idx++}`);
      params.push(own);
    }
    const type = sp.get("type"); if (type) { conditions.push(`type = $${idx++}`); params.push(type); }
    const is_read = sp.get("is_read"); if (is_read !== null && is_read !== undefined) { conditions.push(`is_read = $${idx++}`); params.push(is_read === "true"); }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY sent_at DESC LIMIT 50";
    const { rows } = await query(sql, params);
    return ok(rows || []);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const body = await parseBody(req);

    const errors = validateBody(body, {
      type: { required: true, maxLength: 50, label: "Notification type" },
      title: { required: true, maxLength: 200, label: "Title" },
      message: { required: true, maxLength: 1000, label: "Message" },
      employee_id: { type: "id", label: "Employee" },
      role_id: { type: "id", label: "Role" },
      entity_type: { maxLength: 50, label: "Entity type" },
      entity_id: { type: "id", label: "Entity" },
      link: { maxLength: 500, label: "Link" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const allowedKeys = new Set(["type", "title", "message", "employee_id", "role_id", "entity_type", "entity_id", "link", "is_read", "priority"]);
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) delete body[key];
    }

    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO notifications (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
