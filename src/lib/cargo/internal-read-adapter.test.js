import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/services/cargo-internal-authority', () => ({ assertInternalCargoTrip: vi.fn() }));
import { assertInternalCargoTrip } from '@/services/cargo-internal-authority';
import { createInternalCargoReadAdapter } from './read-adapter';

beforeEach(() => vi.resetAllMocks());
const session = { user: { role: 'fleet_manager', employeeId: 2 } };

it('checks persisted internal trip access before any private history query', async () => {
  assertInternalCargoTrip.mockRejectedValue(Object.assign(new Error('External disabled'), { status: 503 }));
  const query = vi.fn();
  const adapter = createInternalCargoReadAdapter({ db: { withTransaction: work => work({ query }) } });
  await expect(adapter.readHistory({ tripId: 7, session, limit: 20, offset: 0 })).rejects.toMatchObject({ status: 503 });
  expect(query).not.toHaveBeenCalled();
});

it('bounds internal history, omits private payloads and never claims partner delivery', async () => {
  const query = vi.fn(async () => ({ rows: [{ event_id: 'one' }, { event_id: 'two' }] }));
  const adapter = createInternalCargoReadAdapter({ db: { withTransaction: work => work({ query }) } });
  const result = await adapter.readHistory({ tripId: 7, session, limit: 1, offset: 0 });
  expect(result).toEqual({ rows: [{ event_id: 'one' }], has_more: true, latest_feedback: null });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).not.toMatch(/payload|acknowledgement|contact|proof|provenance/i);
  expect(query.mock.calls[0][1]).toEqual([7, 2, 0]);
  await expect(adapter.readHistory({ tripId: 7, session, limit: 500, offset: 0 })).rejects.toMatchObject({ status: 400 });
});
