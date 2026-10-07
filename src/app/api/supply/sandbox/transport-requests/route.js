import { AuthError, err, errValidation, handleError, ok, parseBody, requireAuth } from "@/lib/api/utils";
import { ingestSandboxTransportEvent, SupplyIntegrationError } from "@/lib/supply/sandbox-integration";
import { validateSupplyTransportEvent } from "@/lib/supply/contracts";

function issueMap(issues) {
  return Object.fromEntries(issues.map((issue) => [issue.path.join(".") || "event", issue.message]));
}

export async function POST(req) {
  try {
    const session = await requireAuth(req, ["admin", "super_admin"]);
    if (process.env.NODE_ENV === "production" || process.env.SUPPLY_SCM_SANDBOX_ENABLED !== "true") {
      throw new AuthError("The SCM sandbox importer is disabled in this environment.", 503, "SUPPLY_SANDBOX_DISABLED");
    }

    const parsed = validateSupplyTransportEvent(await parseBody(req));
    if (!parsed.success) return errValidation(issueMap(parsed.error.issues));
    if (!parsed.data.source.organization_id.startsWith("sandbox:")) {
      return err("Sandbox imports require a source organization beginning with 'sandbox:'.", 400);
    }

    const result = await ingestSandboxTransportEvent(parsed.data, session.user.employeeId);
    return ok(result, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof SupplyIntegrationError) return err(error.message, error.status);
    if (error?.code === "23505") return err("The source event sequence has already been used for this request.", 409);
    return handleError(error);
  }
}
