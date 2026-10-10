import { describe, expect, it } from 'vitest';
import { createMockCargoGateway, getCargoGateway } from './cargo-gateway';
import { cargoPayloadHash } from '@/services/cargo-execution.repository';

const principal = { system: 'PMS', organization_id: 'hotel-a' };
const event = { event_id: '11111111-1111-4111-8111-111111111111', payload: { execution_id: '22222222-2222-4222-8222-222222222222', execution_version: 1, source_ref: { system: 'PMS', organization_id: 'hotel-a', external_request_id: 'request-1' }, event_type: 'TRANSPORT_CLOSED', manifest_ref: { kind: 'REQUEST', id: '33333333-3333-4333-8333-333333333333', revision: 1, hash: 'a'.repeat(64) }, receipt: null, decision: null }, payload_hash: null, attempt: 1 };
event.payload_hash=cargoPayloadHash(event.payload);

describe('cargo feedback gateway', () => {
  it('returns a receipt acknowledgement without turning fixture acceptance into a source decision', async () => {
    const gateway = createMockCargoGateway(principal, { outcome: 'ACCEPT' });
    const ack = await gateway.send(event);
    expect(ack).toMatchObject({ event_id: event.event_id, received: true });
    expect(ack).not.toHaveProperty('action');
    expect(await gateway.getAcknowledgement(event.event_id)).toEqual(ack);
  });
  it.each(['WAIT', 'REJECT'])('represents fixture %s as receipt-only feedback', async outcome => {
    const ack = await createMockCargoGateway(principal, { outcome }).send(event);
    expect(ack).toMatchObject({ event_id: event.event_id, received: true, fixture_outcome: outcome });
    expect(ack).not.toHaveProperty('source_decision');
  });
  it('supports timeout fixtures and refuses a source or organization mismatch', async () => {
    await expect(createMockCargoGateway(principal, { outcome: 'TIMEOUT' }).send(event)).rejects.toMatchObject({ code: 'GATEWAY_TIMEOUT' });
    await expect(createMockCargoGateway({ ...principal, organization_id: 'hotel-b' }).send(event)).rejects.toMatchObject({ code: 'CARGO_SOURCE_FORBIDDEN' });
  });
  it('rejects decision-shaped acknowledgements as malformed receipts', async () => {
    const { cargoFeedbackAckSchema } = await import('@/lib/cargo/feedback-contract');
    expect(cargoFeedbackAckSchema.safeParse({ event_id: event.event_id, received: true, action: 'ACCEPT_OBSERVED' }).success).toBe(false);
  });
  it('keeps runtime configuration unavailable unless the caller injects a mock fixture', async () => {
    const gateway = getCargoGateway(principal);
    await expect(gateway.send(event)).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
    await expect(gateway.getAcknowledgement(event.event_id)).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
  });
});
