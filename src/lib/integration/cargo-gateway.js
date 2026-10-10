import { validateCargoFeedbackEnvelope, cargoFeedbackAckSchema } from '@/lib/cargo/feedback-contract';
import { AuthError } from '@/lib/api/utils';

const fail = (code, message, status = 503) => { throw new AuthError(message, status, code); };

export function createMockCargoGateway(principal, { outcome = 'ACCEPT' } = {}) {
  if (process.env.NODE_ENV === 'production' || !['test', 'development'].includes(process.env.NODE_ENV)) {
    fail('CARGO_CONFIGURATION_REQUIRED', 'Mock cargo gateways are limited to nonproduction fixtures.');
  }
  if (!['PMS', 'POS', 'SCM'].includes(principal?.system) || typeof principal?.organization_id !== 'string' || !principal.organization_id.trim()) {
    fail('CARGO_SOURCE_FORBIDDEN', 'A source and organization are required.', 403);
  }
  if (!['ACCEPT', 'WAIT', 'REJECT', 'TIMEOUT'].includes(outcome)) fail('CARGO_INVALID_INPUT', 'Unsupported mock feedback fixture.', 400);
  const acknowledgements = new Map();
  return {
    async send(input) {
      const parsed = validateCargoFeedbackEnvelope(input);
      if (parsed.payload.source_ref.system !== principal.system || parsed.payload.source_ref.organization_id !== principal.organization_id) {
        fail('CARGO_SOURCE_FORBIDDEN', 'Event source does not match the gateway.', 403);
      }
      if (outcome === 'TIMEOUT') fail('GATEWAY_TIMEOUT', 'Partner acknowledgement timed out.', 503);
      const ack = cargoFeedbackAckSchema.parse({ event_id: parsed.event_id, received: true, fixture_outcome: outcome });
      acknowledgements.set(parsed.event_id, ack);
      return ack;
    },
    async getAcknowledgement(eventId) { return acknowledgements.get(eventId) ?? null; },
  };
}

// Provider endpoints and credentials are intentionally unavailable until approved configuration exists.
export function getCargoGateway(principal) {
  if (!['PMS', 'POS', 'SCM'].includes(principal?.system) || typeof principal?.organization_id !== 'string' || !principal.organization_id.trim()) {
    fail('CARGO_SOURCE_FORBIDDEN', 'A source and organization are required.', 403);
  }
  return {
    async send() { fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo partner gateway is not configured.'); },
    async getAcknowledgement() { fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo partner gateway is not configured.'); },
  };
}
