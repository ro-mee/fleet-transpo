import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { deliveryFor, sendPush } from "@/services/push.service";

export async function GET(req) {
  try {
    const session = await requireAuth(req, [
      "system_admin",
      "admin",
      "fleet_manager",
      "dispatcher",
      "management",
      "driver",
    ]);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT n.*, di.severity AS severity, di.incident_type AS incident_subtype
                 FROM notifications n
                 LEFT JOIN driverincidents di ON n.reference_type = 'incident' AND di.incident_id = n.reference_id`;
    const params = []; let idx = 1;
    const conditions = [];
    const own = session.user?.employeeId ?? session.user?.userId ?? null;
    const canScopeAll = ["system_admin", "admin", "fleet_manager"].includes(session.user?.role);
    const target = sp.get("employee_id");
    if (target) {
      if (!canScopeAll) return err("Not authorized to view another user's notifications", 403);
      conditions.push(`n.employee_id = $${idx++}`); params.push(+target);
    } else if (own) {
      // employee_id is int and user_id is uuid, so both cannot share one param
      // typed against one column: comparing the numeric employeeId to the uuid
      // user_id column makes Postgres throw a cast error and the self-scoped
      // read 500s. Scope on whichever identity is actually present.
      const isEmp = session.user?.employeeId != null;
      conditions.push(isEmp ? `n.employee_id = $${idx++}` : `n.user_id = $${idx++}`);
      params.push(own);
    }
    const type = sp.get("type"); if (type) { conditions.push(`n.type = $${idx++}`); params.push(type); }
    const is_read = sp.get("is_read"); if (is_read !== null && is_read !== undefined) { conditions.push(`n.is_read = $${idx++}`); params.push(is_read === "true"); }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY n.sent_at DESC LIMIT 50";
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
    const notif = rows[0];

    // Best-effort real push for rows that earn an OS surface (push or heads-up
    // tier) — a delivery hiccup must never fail the notification write the
    // caller just got a 201 for.
    try {
      const delivery = notif && deliveryFor(notif);
      if (delivery) {
        let targets = [];
        if (notif.employee_id) {
          targets.push(notif.employee_id);
        } else if (body.role_id) {
          const { rows: emps } = await query(
            `SELECT e.employee_id
               FROM employees e
              WHERE e.role_id = $1 AND e.deleted_at IS NULL`,
            [Number(body.role_id)]
          );
          targets = emps.map((x) => x.employee_id);
        }
        if (targets.length) {
          await sendPush({
            employeeIds: targets,
            title: notif.title,
            body: notif.message,
            data: { reference_type: notif.reference_type, reference_id: notif.reference_id },
            channelId: delivery.channelId,
            sound: delivery.sound,
          });
        }
      }
    } catch (e) {
      console.warn("notification push failed:", e?.message || e);
    }

    return ok(notif, 201);
  } catch (e) { return handleError(e); }
}
