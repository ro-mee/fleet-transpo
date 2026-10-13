import { query } from "@/lib/db";
import { sendPush } from "@/services/push.service";
import { dedupeEmployeeIds } from "@/lib/notifications/recipients";

// Shared create/edit fan-out: only newly inserted notification rows get a push.
export async function fanoutMaintenanceNotification({ employeeIds, copy, referenceType, referenceId, type = "Info" }) {
  const targets = dedupeEmployeeIds(employeeIds);
  if (!targets.length) return;
  const pushed = [];
  for (const employeeId of targets) {
    const { rows: done } = await query(
      `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
       SELECT $1, $2::varchar, $3, $4, $5::varchar, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE employee_id = $1 AND title = $2::varchar
             AND reference_type = $5::varchar AND reference_id = $6
        )
       RETURNING employee_id`,
      [employeeId, copy.title, copy.message, type, referenceType, referenceId]
    );
    if (done[0]) pushed.push(employeeId);
  }
  if (pushed.length) {
    await sendPush({
      employeeIds: pushed,
      title: copy.title,
      body: copy.pushBody,
      data: { reference_type: referenceType, reference_id: referenceId },
    });
  }
}
