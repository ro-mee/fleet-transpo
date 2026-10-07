import { z } from "zod";
import { err, errValidation, handleError, ok, parseBody, requirePermission } from "@/lib/api/utils";
import { evaluateSupplyLoad } from "@/lib/supply/capacity";
import { getSupplyShipmentForFleetLoadEvaluation } from "@/lib/supply/sandbox-integration";

const requestSchema = z.object({
  shipment_id: z.string().uuid(),
}).strict();

const NOT_EVALUATED = [
  "driver qualification, license class, training, duty, leave, and work schedule",
  "shared vehicle and driver dispatch-overlap checks",
  "route and delivery-window feasibility",
  "vehicle documents, inspection, and live roadworthiness evidence",
  "trip occupant or equipment mass",
  "loading arrangement, axle balance, and load securement",
];

export async function POST(req) {
  try {
    await requirePermission(req, "dispatch", "read_all");
    const parsed = requestSchema.safeParse(await parseBody(req));
    if (!parsed.success) {
      return errValidation(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join(".") || "request", issue.message])));
    }

    const input = await getSupplyShipmentForFleetLoadEvaluation(parsed.data.shipment_id);
    if (!input) return err("Shipment not found.", 404);

    const evaluatedAt = new Date();
    return ok({
      shipment_id: parsed.data.shipment_id,
      evaluation_scope: "MEASURED_LOAD_FIT_PRE_SCREEN",
      assignment_eligibility: "NOT_EVALUATED",
      not_evaluated: NOT_EVALUATED,
      vehicles: input.vehicles.map(({ vehicle, profile }) => ({
        ...vehicle,
        evaluation: evaluateSupplyLoad(input.manifest, profile, evaluatedAt),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
