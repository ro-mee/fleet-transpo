import { z } from "zod";
import { err, errValidation, handleError, ok, parseBody, requirePermission } from "@/lib/api/utils";
import { evaluateSupplyLoad } from "@/lib/supply/capacity";
import { getSupplyShipmentForEvaluation } from "@/lib/supply/sandbox-integration";

const evaluationRequest = z.object({
  shipment_id: z.string().uuid(),
  vehicle_id: z.number().int().positive(),
}).strict();

export async function POST(req) {
  try {
    await requirePermission(req, "dispatch", "read_all");
    const parsed = evaluationRequest.safeParse(await parseBody(req));
    if (!parsed.success) {
      return errValidation(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join(".") || "request", issue.message])));
    }
    const input = await getSupplyShipmentForEvaluation(parsed.data.shipment_id, parsed.data.vehicle_id);
    if (!input) return err("Shipment or vehicle not found.", 404);
    return ok({
      shipment_id: parsed.data.shipment_id,
      vehicle_id: parsed.data.vehicle_id,
      evaluation: evaluateSupplyLoad(input.manifest, input.profile),
    });
  } catch (error) {
    return handleError(error);
  }
}
