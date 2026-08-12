import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const filePath = join(process.cwd(), "resources", "ai", "instructions.md");
    const content = await readFile(filePath, "utf-8");
    return ok({ content, actor: { employeeId: session.user.employeeId } });
  } catch (e) { return handleError(e); }
}
