import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { listEmployeeSessions } from "@/lib/auth/sessions";
import { writeAudit } from "@/lib/audit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req) {
  try {
    const session = await requireAuth(req, "*");
    return ok({ sessions: await listEmployeeSessions(session.user.employeeId, session.user.sessionId) });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(req) {
  try {
    const session = await requireAuth(req, "*");
    const body = await parseBody(req);
    const kind = body?.kind;
    const id = String(body?.id || "");
    if (!UUID.test(id) || !["web", "mobile"].includes(kind)) return err("Invalid session", 400);

    const employeeId = session.user.employeeId;
    const result = kind === "web"
      ? await query(
          `UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, NOW())
             WHERE session_id = $1 AND employee_id = $2 AND revoked_at IS NULL`,
          [id, employeeId]
        )
      : await query(
          `UPDATE mobile_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW())
             WHERE family_id = $1 AND employee_id = $2 AND revoked_at IS NULL`,
          [id, employeeId]
        );
    if (!result.rowCount) return err("Session not found or already signed out", 404);

    await writeAudit(req, session, {
      action: "session_revoke",
      resource: kind === "web" ? "web_session" : "mobile_session",
      newValues: { session_id: id, kind },
    });
    return ok({ message: "Session signed out", signInRequired: kind === "web" && id === session.user.sessionId });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");
    const employeeId = session.user.employeeId;
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, NOW())
           WHERE employee_id = $1 AND revoked_at IS NULL AND session_id <> $2`,
        [employeeId, session.user.sessionId]
      );
      await tx.query(
        `UPDATE mobile_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW())
           WHERE employee_id = $1 AND revoked_at IS NULL`,
        [employeeId]
      );
    });
    await writeAudit(req, session, {
      action: "session_revoke_others",
      resource: "sessions",
      newValues: { current_session_preserved: true },
    });
    return ok({ message: "Other sessions signed out" });
  } catch (error) {
    return handleError(error);
  }
}
