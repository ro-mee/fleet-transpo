import { afterEach, expect, it, vi } from 'vitest';
import * as db from '@/lib/db';
import * as utils from '@/lib/api/utils';
import * as field from '@/lib/incidents/field-resolution';
import { POST as arrive } from './arrived/route';
import { POST as resolve } from './resolve/route';
afterEach(() => vi.restoreAllMocks());
it.each([['arrive', arrive], ['resolve', resolve]])('%s refuses an expected incident that differs from the current assignment before any mutation', async (_name, action) => {
  vi.spyOn(utils, 'requireDriver').mockResolvedValue({ user: { driverId: 7, employeeId: 9 } });
  const query = vi.fn(async () => ({ rows: [{ incident_id: 22, status: 'Open', response_status: 'Dispatched' }] }));
  vi.spyOn(db, 'withTransaction').mockImplementation(fn => fn({ query }));
  vi.spyOn(db, 'query').mockResolvedValue({ rows: [{ incident_id: 22 }] });
  const core = vi.spyOn(field, 'resolveFromField').mockResolvedValue({ guard: 'not-arrived' });
  const response = await action(new Request('http://test/api/driver/responder/'+_name, { method: 'POST', body: JSON.stringify({ incident_id: 11 }) }));
  expect(response.status).toBe(409); expect(core).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT)\b/i.test(sql))).toBe(false);
});
it.each([arrive, resolve])('rejects malformed expected incident IDs before reading assignments', async action => {
  vi.spyOn(utils, 'requireDriver').mockResolvedValue({ user: { driverId: 7 } });
  const query = vi.spyOn(db, 'query'); const transaction = vi.spyOn(db, 'withTransaction');
  const response = await action(new Request('http://test/api', { method: 'POST', body: JSON.stringify({ incident_id: 'wrong' }) }));
  expect(response.status).toBe(400); expect(query).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
});

it.each([undefined, 22])('keeps legacy empty body and matching expected ID arrival compatible: %j', async incidentId => {
  vi.spyOn(utils, 'requireDriver').mockResolvedValue({ user: { driverId: 7 } });
  const query = vi.fn(async () => ({ rows: [{ incident_id: 22, response_status: 'Arrived' }] }));
  vi.spyOn(db, 'withTransaction').mockImplementation(fn => fn({ query }));
  const response = await arrive(new Request('http://test/api', { method: 'POST', ...(incidentId == null ? {} : { body: JSON.stringify({ incident_id: incidentId }) }) }));
  expect(response.status).toBe(200); expect((await response.json()).incident_id).toBe(22); expect(query).toHaveBeenCalledOnce();
});
