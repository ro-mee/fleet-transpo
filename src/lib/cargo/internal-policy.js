// Server-owned local workflow policy; these are not approvals from an outside system.
export const INTERNAL_CARGO_CONFIG = Object.freeze({
  internalRuntime: true, simulated: false, schemaReady: true,
  dataApprovalRef: 'internal-cargo-v1', privacyApprovalRef: 'internal-private-evidence-v1',
  receivingApprovalRef: 'internal-manager-receiving-v1', retentionApprovalRef: 'internal-preserve-evidence-v1',
  sourceApprovalRef: 'internal-manager-release-v1', safetyApprovalRef: 'internal-manager-securement-v1',
  fleetApprovalRef: 'internal-manager-v1', staffReadApprovalRef: 'internal-cargo-read-v1', lifecycleApprovalRef: 'internal-cargo-lifecycle-v1',
});
