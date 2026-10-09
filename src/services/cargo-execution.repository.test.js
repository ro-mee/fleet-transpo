import { it, expect, vi } from 'vitest';
import { insertReceipt, appendCargoDecision, loadExecutionForUpdate, appendCargoFeedback } from './cargo-execution.repository';
import { cargoFeedbackSchema } from '@/lib/cargo/contracts';

it('refuses unconfigured repository access before any database operation', async () => {
  const tx = { query: vi.fn() };
  for (const work of [() => insertReceipt({}, {}, tx), () => appendCargoDecision({}, {}, tx), () => loadExecutionForUpdate(1, tx), () => appendCargoFeedback({}, tx)]) await expect(work()).rejects.toMatchObject({ status: 503 });
  expect(tx.query).not.toHaveBeenCalled();
});
it('validates durable event types and refuses acknowledgement as a source decision', () => {
  expect(cargoFeedbackSchema.safeParse({ event_type: 'ACKNOWLEDGED' }).success).toBe(false);
  expect(cargoFeedbackSchema.safeParse({ event_type: 'SOURCE_DECISION_RECORDED', decision: { action: 'ACKNOWLEDGED' } }).success).toBe(false);
});
