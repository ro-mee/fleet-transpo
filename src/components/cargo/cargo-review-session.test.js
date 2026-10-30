import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { employeeId: 1, sessionId: 'session', role: 'fleet_manager' } } }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('./cargo-handover-evidence', () => ({ CargoHandoverEvidence: () => null, CargoHandoverEvidenceContent: () => null }));
import { useQuery } from '@tanstack/react-query';
import { CargoVerificationPanel } from './cargo-verification-panel';
globalThis.React = React;

it.each([401,403,404])('discards previously read counts and photos when the trip refresh refuses access (%s)', status => {
  useQuery.mockReturnValue({ error: { status, message: 'Access refused' }, data: {
    manifest: { source_ref: { system: 'INTERNAL' }, manifest_ref: { kind: 'REQUEST' }, lines: [] },
    pickup_receipt: { payload: { lines: [{ line_id: 'private-line', evidence_ids: ['11111111-1111-4111-8111-111111111111'] }] } },
  } });
  const markup = renderToStaticMarkup(<CargoVerificationPanel tripId={7} />);
  expect(markup).not.toContain('Private receipt photos');
  expect(markup).not.toContain('Quantity comparison');
  expect(markup).toContain('Cargo review unavailable');
});
