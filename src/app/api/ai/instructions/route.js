import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { REPORT_TYPES } from "@/lib/ai/report-narrative";

export async function GET(req) {
  try {
    const session = await requirePermission(req, "ai_settings", "read");
    const base = join(process.cwd(), "resources", "ai");
    const mainPath = join(base, "instructions.md");
    const [content, reportFiles] = await Promise.all([
      readFile(mainPath, "utf-8"),
      readdir(join(base, "reports"), { withFileTypes: true }).catch(() => []),
    ]);

    const reports = [];
    for (const type of REPORT_TYPES) {
      const f = `${type}.md`;
      const exists = reportFiles.some((d) => d.isFile() && d.name === f);
      let reportContent = null;
      if (exists) {
        try {
          reportContent = await readFile(join(base, "reports", f), "utf-8");
        } catch {
          reportContent = null;
        }
      }
      reports.push({ report: type, exists, content: reportContent });
    }

    return ok({ content, reports, actor: { employeeId: session.user.employeeId } });
  } catch (e) { return handleError(e); }
}
