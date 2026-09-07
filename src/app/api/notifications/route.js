import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { deliveryFor, sendPush } from "@/services/push.service";
import { rolesFor } from "@/lib/auth/permissions";

export async function GET(req) {
  try {
    const session = await requirePermission(req, "notifications", "read");
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT n.*, di.severity AS severity, di.incident_type AS incident_subtype
                 FROM notifications n
                 LEFT JOIN driverincidents di ON n.reference_type = 'incident' AND di.incident_id = n.reference_id`;
    const params = []; let idx = 1;
    const conditions = [];
    const own = session.user?.employeeId ?? session.user?.userId ?? null;
    const canScopeAll = rolesFor("notifications", "read_all").includes(session.user?.role);
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
    await requirePermission(req, "notifications", "create");
    const body = await parseBody(req);

    const errors = validateBody(body, {
      type: { required: true, maxLength: 50, label: "Notification type" },
      title: { required: true, maxLength: 200, label: "Title" },
      message: { required: true, maxLength: 1000, label: "Message" },
      employee_id: { type: "id", label: "Employee" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    // Creation contract is exactly the storable columns. Stale keys
    // (role_id, entity_type, entity_id, link, priority) have no backing
    // columns and are dropped rather than failing the INSERT. is_read DOES
    // exist in storage but is server/user-state controlled (mark-read
    // routes) and must never be client-set at creation.
    const allowedKeys = new Set(["type", "title", "message", "employee_id", "channel", "reference_type", "reference_id"]);
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
        // Broadcast goes through per-employee fan-out producers
        // (notificationRolesFor → resolveNotificationRecipients), never a
        // role_id expansion — there is no role column to persist it on.
        let targets = [];
        if (notif.employee_id) {
          targets.push(notif.employee_id);
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
