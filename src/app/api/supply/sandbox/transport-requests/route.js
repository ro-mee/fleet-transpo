import { AuthError, err, errValidation, handleError, ok, parseBody, requireAuth } from "@/lib/api/utils";
import {
  hashSupplyPayload,
  ingestSandboxTransportEvent,
  recordSandboxImportAttempt,
  SupplyIntegrationError,
} from "@/lib/supply/sandbox-integration";
import { validateSupplyTransportEvent } from "@/lib/supply/contracts";

function issueMap(issues) {
  return Object.fromEntries(issues.map((issue) => [issue.path.join(".") || "event", issue.message]));
}

export async function POST(req) {
  let actorEmployeeId = null;
  let validatedEvent = null;
  try {
    const session = await requireAuth(req, ["admin", "super_admin"]);
    actorEmployeeId = session.user.employeeId;
    if (process.env.NODE_ENV === "production" || process.env.SUPPLY_SCM_SANDBOX_ENABLED !== "true") {
      throw new AuthError("The SCM sandbox importer is disabled in this environment.", 503, "SUPPLY_SANDBOX_DISABLED");
    }

    const body = await parseBody(req);
    const parsed = validateSupplyTransportEvent(body);
    if (!parsed.success) {
      await recordSandboxImportAttempt({
        value: body,
        payloadHash: hashSupplyPayload(body),
        actorEmployeeId,
        rejectionCode: "SCHEMA_INVALID",
        responseStatus: 400,
      });
      return errValidation(issueMap(parsed.error.issues));
    }
    validatedEvent = parsed.data;
    if (!validatedEvent.source.organization_id.startsWith("sandbox:")) {
      return err("Sandbox imports require a source organization beginning with 'sandbox:'.", 400);
    }

    const result = await ingestSandboxTransportEvent(validatedEvent, actorEmployeeId);
    return ok(result, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof SupplyIntegrationError) return err(error.message, error.status);
    if (error?.code === "23505" && validatedEvent && actorEmployeeId != null) {
      const conflict = {
        uq_supply_inbox_event: {
          rejectionCode: "SOURCE_EVENT_ID_CONFLICT",
          message: "The source event ID has already been used.",
        },
        uq_supply_inbox_sequence: {
          rejectionCode: "SOURCE_SEQUENCE_CONFLICT",
          message: "The source event sequence has already been used for this request.",
        },
        uq_supply_shipment_source_request: {
          rejectionCode: "SOURCE_REQUEST_CONFLICT",
          message: "This source request already exists.",
        },
      }[error.constraint] || {
        rejectionCode: "DATABASE_UNIQUENESS_CONFLICT",
        message: "This sandbox event conflicts with an existing source record.",
      };
      await recordSandboxImportAttempt({
        value: validatedEvent,
        payloadHash: hashSupplyPayload(validatedEvent),
        actorEmployeeId,
        rejectionCode: conflict.rejectionCode,
        responseStatus: 409,
      });
      return err(conflict.message, 409);
    }
    return handleError(error);
  }
}
