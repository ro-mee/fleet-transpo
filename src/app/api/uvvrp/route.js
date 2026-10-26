import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { getBoardData } from "@/lib/uvvrp/uvvrp.service";

// Read-only UVVRP board: restricted vehicles, exemptions, upcoming restrictions,
// violation history, and dispatches affected.
export async function GET(req) {
  try {
    await requirePermission(req, "uvvrp", "read");
    const sp = new URL(req.url).searchParams;
    const date = sp.get("date") || undefined;
    // A non-key date would silently degrade the board (weekday null, "NaN"
    // week keys); the picker always sends a plain calendar key.
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("date must be a YYYY-MM-DD calendar day.", 400);
    return ok(await getBoardData({ date }));
  } catch (e) {
    return handleError(e);
  }
}
