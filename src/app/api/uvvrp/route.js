import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { getBoardData } from "@/lib/uvvrp/uvvrp.service";

// Read-only UVVRP board: restricted vehicles, exemptions, upcoming restrictions,
// violation history, and dispatches affected.
export async function GET(req) {
  try {
    await requirePermission(req, "uvvrp", "read");
    const sp = new URL(req.url).searchParams;
    return ok(await getBoardData({ date: sp.get("date") || undefined }));
  } catch (e) {
    return handleError(e);
  }
}
