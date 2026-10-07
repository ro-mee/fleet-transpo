import { z } from "zod";
import { parseTransportationRequest, parseV2TransportationRequest } from "@/lib/integration/contracts";

const source = z.enum(["PMS", "POS", "Web"]);
const id = z.string().min(1).max(255).refine((value) => value.trim().length > 0, "ID must not be blank");
const v2 = z.object({
  contract_version: z.literal(2),
  external_request_id: id,
  external_revision: z.number().int().positive(),
  event_id: id,
  event_kind: z.enum(["create", "update", "cancel"]),
  request: z.record(z.string(), z.unknown()).optional(),
});

/** Source must be the authenticated adapter identity, never raw.source_system. */
export function normalizeInboundEnvelope(raw, authenticatedSource) {
  const source_system = source.parse(authenticatedSource);
  if (raw?.contract_version === undefined || raw?.contract_version === 1) {
    if (source_system !== "PMS") throw new Error("Legacy v1 is PMS-only");
    const request = parseTransportationRequest({ ...raw, source_system });
    return {
      contract_version: 1, source_system,
      external_request_id: request.external_booking_id,
      external_revision: 1,
      event_id: `legacy:${request.external_booking_id}`,
      event_kind: "create", request,
    };
  }
  const parsed = v2.parse(raw);
  if (parsed.event_kind !== "cancel" && !parsed.request) throw new Error("request is required");
  // Updates carry the same complete typed snapshot as creates, not an unchecked
  // partial patch. Validation does not authorize persistence or a Fleet transition.
  const request = parsed.event_kind !== "cancel"
    ? parseV2TransportationRequest({ ...parsed.request, external_booking_id: parsed.external_request_id, source_system })
    : null;
  return { ...parsed, source_system, request };
}
