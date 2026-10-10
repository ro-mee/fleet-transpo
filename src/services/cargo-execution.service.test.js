import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitCargoReceipt, recordSourceDecision, clearCargoDeparture, getCargoExecution, createCargoExecutionService } from './cargo-execution.service';

describe('cargo execution runtime remains disabled', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([submitCargoReceipt, recordSourceDecision, clearCargoDeparture, getCargoExecution])('refuses runtime access without authority before any database call', async operation => {
    await expect(operation(1, {}, {})).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
  });
  it('does not turn an arbitrary config object into an operational provider', () => {
    expect(() => createCargoExecutionService({ config: { schemaReady: true } })).toThrow(expect.objectContaining({ status: 503 }));
  });
  it('refuses even a complete simulated configuration in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const config = Object.fromEntries(['dataApprovalRef', 'privacyApprovalRef', 'receivingApprovalRef', 'retentionApprovalRef', 'sourceApprovalRef', 'safetyApprovalRef', 'fleetApprovalRef'].map(key => [key, 'simulated:approval']));
    expect(() => createCargoExecutionService({ config: { ...config, schemaReady: true, simulated: true, environment: 'test' }, db: { withTransaction: async () => {} } })).toThrow(expect.objectContaining({ status: 503 }));
  });
});
