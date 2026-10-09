// D01–D10 owner/privacy approvals, exact source scopes and schema activation
// are absent. This explicit refusal is the only installed runtime behavior.
// The tested service/auth contracts can be wired after those gates are reviewed.
export async function POST() {
  return Response.json({ error: 'Cargo manifest intake is not configured.', code: 'CARGO_CONFIGURATION_REQUIRED' }, { status: 503 });
}
