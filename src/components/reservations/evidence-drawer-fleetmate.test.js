import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn(async () => ({})) }));

import { EvidenceBody, EligibilityInspector, buildInspectorRows } from './evidence-drawer';
import { conversationEvidence } from '@/lib/dispatch/conversation';
import { attachClearanceProofs, attachEvidenceProofs, projectEvidenceFacts, EVIDENCE_TYPES, EVIDENCE_TITLES, MANAGING_MODULE } from '@/lib/dispatch/evidence-contract';
import { makePair, blockedPair, unverifiedPair, immediatePair, repositioningPair, makeRequest, makeRecommendation, FUTURE_INSTANT } from '@/lib/dispatch/fleetmate-fixtures';
import { narrationGuards, guardDisclosure } from '@/lib/dispatch/narration-guards';

process.env.NEXTAUTH_SECRET ??= 'test-secret-for-evidence';

// Group L of the FleetMate scenario matrix: the Evidence Drawer renders the SAME
// evidence the Copilot narrated. Structural rendering only — the environment has
// no DOM, so interactive behaviour (fetch-once-per-open, no refetch on plan
// validation, tap-to-open a row proof) is covered by the effect-dependency and
// static assertions in evidence-drawer.test.js and is listed as PENDING browser
// verification in the manual acceptance checklist.

const REQUEST_ID = 502;
const request = () => makeRequest();

/** The full handoff the conversation route performs, up to projection. */
const handoff = (pairs, opts = {}) =>
  attachEvidenceProofs(attachClearanceProofs(conversationEvidence(request(), makeRecommendation({ candidates: pairs, ...opts })), REQUEST_ID), REQUEST_ID);

const inspector = (pair, onReviewProof = () => {}) =>
  renderToStaticMarkup(React.createElement(EligibilityInspector, {
    pairLabel: `${pair.driverName ?? 'Driver'} + ${pair.plate ?? 'Vehicle'}`,
    horizon: pair.clearanceMeta.horizon,
    rows: buildInspectorRows(pair.clearance, pair.clearanceMeta),
    onReviewProof,
  }));

beforeEach(() => { vi.stubGlobal('React', React); vi.clearAllMocks(); });

describe('L. Evidence Drawer renders the narrated evidence', () => {
  it('FM-DRAW-001 inspector rows carry the engine check labels and the matching state', () => {
    const evidence = handoff([blockedPair({ maintenance: 'Vehicle is under Preventive Maintenance during this window.' }, { vehicle_id: 21, driver_id: 3 })]);
    const pair = evidence.pairs[0];
    const html = inspector(pair);
    // Same labels the chat used, drawn from the same projected checks.
    for (const check of pair.checks) expect(html).toContain(check.label);
    expect(pair.checks.map(c => c.id)).toEqual(pair.clearance.map(c => c.checkId).filter(id => id !== 'leave'));
    // State mapping: verified -> clear, blocking -> blocked, missing -> verify.
    const rows = buildInspectorRows(pair.clearance, pair.clearanceMeta);
    expect(rows.find(r => r.label === 'Service-window maintenance')).toMatchObject({ state: 'blocked', note: 'See exclusion proof' });
    expect(rows.find(r => r.label === 'Seating capacity')).toMatchObject({ state: 'clear', note: 'No blocking issue found' });
    expect(html).toContain('See exclusion proof');

    const unverified = handoff([unverifiedPair(['maintenance'])]);
    expect(buildInspectorRows(unverified.pairs[0].clearance, unverified.pairs[0].clearanceMeta).find(r => r.label === 'Service-window maintenance'))
      .toMatchObject({ state: 'verify', note: 'Needs verification' });
  });

  it('FM-DRAW-002 only rows with a resolvable proof offer a Review action', () => {
    const evidence = handoff([blockedPair({ maintenance: 'Vehicle is under Preventive Maintenance during this window.' }, { vehicle_id: 21, driver_id: 3 })]);
    const rows = buildInspectorRows(evidence.pairs[0].clearance, evidence.pairs[0].clearanceMeta);
    // A blocked check has no clearance snapshot, so it cannot be reviewed here.
    expect(rows.find(r => r.state === 'blocked').proof).toBeNull();
    // Exactly the rows with no record-scoped proof type (or no clearance) render
    // without a drill-down. The label itself still renders, so the check is
    // never hidden from the dispatcher.
    expect(rows.filter(r => r.proof == null).map(r => r.label)).toEqual([
      'Request requirements', 'Service-window maintenance', 'Blocking incident check', 'Requested vehicle class', 'Current GPS',
    ]);
    expect(rows.filter(r => r.proof?.ref).map(r => r.label)).toEqual([
      'Seating capacity', 'Vehicle registration', 'Vehicle insurance', 'Driver license',
      'Effective driver and vehicle pairing', 'Duty, leave and resource schedule', 'Leave',
    ]);
    const html = inspector(evidence.pairs[0]);
    expect(html.match(/>Review</g)).toHaveLength(rows.filter(r => r.proof?.ref).length);
    // Read-only chrome: no form control of any kind.
    expect(html).not.toMatch(/<input|<select|<textarea|<form/);
  });

  it('FM-DRAW-003 the GPS row follows the evaluation horizon and never invents a reading', () => {
    const future = buildInspectorRows([], { horizon: 'FUTURE', gpsHealth: 'Fresh' });
    expect(future.at(-1)).toMatchObject({ label: 'Current GPS', state: 'na', note: 'Not applicable' });
    expect(buildInspectorRows([], { horizon: 'SAME_DAY', gpsHealth: 'Fresh' }).at(-1)).toMatchObject({ label: 'Current GPS', state: 'na' });
    expect(buildInspectorRows([], { horizon: 'NEAR_DISPATCH', gpsHealth: 'Fresh' }).at(-1)).toMatchObject({ label: 'GPS Health', state: 'clear', note: 'Fresh' });
    expect(buildInspectorRows([], { horizon: 'LAST_MINUTE', gpsHealth: 'Offline' }).at(-1)).toMatchObject({ state: 'clear', note: 'Offline' });
    // No health supplied on an immediate horizon is reported as unknown, not clear.
    expect(buildInspectorRows([], { horizon: 'NEAR_DISPATCH', gpsHealth: null }).at(-1)).toMatchObject({ label: 'GPS Health', state: 'verify', note: 'Unknown' });
    // The dispatch mode alone is enough to mark the row not applicable: a
    // repositioning candidate runs on a present-tense horizon, so the horizon
    // test can never see it (FM-DRAW-014).
    expect(buildInspectorRows([], { horizon: 'NEAR_DISPATCH', mode: 'REPOSITION', gpsHealth: null }).at(-1)).toMatchObject({ label: 'Current GPS', state: 'na', note: 'Not applicable' });
    expect(buildInspectorRows([], { horizon: 'LAST_MINUTE', mode: 'SCHEDULED', gpsHealth: 'Offline' }).at(-1)).toMatchObject({ label: 'GPS Health', state: 'clear' });

    // The row agrees with the pair the chat narrated.
    const live = handoff([immediatePair({ gpsHealth: 'Delayed' })]);
    expect(inspector(live.pairs[0])).toContain('Delayed');
    const futurePair = handoff([makePair()]);
    expect(inspector(futurePair.pairs[0])).toContain('Not applicable');
  });

  it('FM-DRAW-014 a repositioning candidate shows GPS as not applicable, not as unknown', () => {
    const evidence = handoff([repositioningPair()]);
    const pair = evidence.pairs[0];
    // The mode is what excludes live location — the horizon is a timing band,
    // and this pair's horizon is a present-tense one, so the horizon alone would
    // read the deliberate exclusion as a gap in the evidence.
    expect(pair.temporalContext.horizon).not.toBe('REPOSITION');
    expect(pair.temporalContext.horizon).toBe('NEAR_DISPATCH');
    expect(pair.clearanceMeta.mode).toBe('REPOSITION');
    expect(pair).not.toHaveProperty('gpsHealth');
    const row = buildInspectorRows(pair.clearance, pair.clearanceMeta).at(-1);
    expect(row).toMatchObject({ label: 'Current GPS', state: 'na', note: 'Not applicable' });
    // The narration the prompt forbids: absence of live evidence read as missing
    // evidence. The rendered drawer must not carry it.
    expect(inspector(pair)).not.toContain('Unknown');

    // And the reason is the mode, not a side effect of an absent reading: the
    // same projection with an immediate mode still reports the reading as
    // unknown rather than not applicable.
    const immediate = handoff([immediatePair({ gpsHealth: null, liveLocationUsed: false })]);
    expect(immediate.pairs[0].clearanceMeta.mode).toBe('IMMEDIATE');
    expect(buildInspectorRows(immediate.pairs[0].clearance, immediate.pairs[0].clearanceMeta).at(-1))
      .toMatchObject({ label: 'GPS Health', state: 'verify', note: 'Unknown' });
  });

  it('FM-DRAW-004 the inspector keeps locked eligibility copy and no assignment language', () => {
    const evidence = handoff([makePair({ vehicle_id: 4, driver_id: 4, vehicle: { plate_number: 'ABC 1234' }, driver: { driver_name: 'Ana Reyes' } })]);
    const html = inspector(evidence.pairs[0]);
    expect(html).toContain('Eligible based on the evaluated server evidence');
    expect(html).toContain('Evaluation horizon: FUTURE');
    expect(html).toContain('Ana Reyes + ABC 1234');
    expect(html).not.toMatch(/definitely|guarantee|all clear|therefore assign|assign now|confirm/i);
  });

  it('FM-DRAW-005 the drawer shows exactly the allowlisted facts the chat pointed at', () => {
    const facts = projectEvidenceFacts(EVIDENCE_TYPES.LEAVE, {
      driverName: 'Marco Santos', status: 'Approved', startDate: '2026-09-18', endDate: '2026-09-19',
      overlapsBooking: true, verdict: 'blocked',
      reason: 'Family emergency', history: [{ id: 1 }], hrNotes: 'private',
    });
    const html = renderToStaticMarkup(React.createElement(EvidenceBody, {
      proofType: EVIDENCE_TYPES.LEAVE, planStatus: null,
      data: { title: EVIDENCE_TITLES[EVIDENCE_TYPES.LEAVE], managingModule: MANAGING_MODULE[EVIDENCE_TYPES.LEAVE], checkedAt: '2026-09-17T17:42:10+08:00', facts },
    }));
    expect(html).toContain('Marco Santos');
    expect(html).toContain('Attendance &amp; Leave');
    expect(html).toContain('Leave from');
    expect(html).toContain('Leave until');
    expect(html).toContain('Yes');       // overlapsBooking: true
    expect(html).toContain('Blocking');  // verdict mapping
    expect(html).toContain('read-only here');
    expect(html).not.toMatch(/Family emergency|private|hrNotes|history|—/);
    expect(html).not.toMatch(/<button|<input|<select|<form/);

    // A stale plan state adds the warning without rewriting the snapshot facts.
    const stale = renderToStaticMarkup(React.createElement(EvidenceBody, {
      proofType: EVIDENCE_TYPES.LEAVE,
      planStatus: { isInvalid: true, invalidReason: 'Queue plan changed.' },
      data: { title: EVIDENCE_TITLES[EVIDENCE_TYPES.LEAVE], managingModule: MANAGING_MODULE[EVIDENCE_TYPES.LEAVE], checkedAt: '2026-09-17T17:42:10+08:00', facts },
    }));
    expect(stale).toContain('Conditions have changed since this evidence was checked');
    expect(stale).toContain('Marco Santos');
  });

  it('FM-DRAW-006 a blocking incidental finding never reaches the drawer as a narrative', () => {
    // The chat exposes incident ids only; the drawer shows identity and status,
    // never description, location or actions taken.
    const facts = projectEvidenceFacts(EVIDENCE_TYPES.INCIDENT, {
      incidentId: 2041, type: 'Breakdown', severity: 'High', status: 'Open', incidentDate: '2026-09-10',
      description: 'Engine failure on EDSA', location: 'EDSA cor. Ayala', actionsTaken: 'Towed', verdict: 'blocked',
    });
    expect(Object.keys(facts).sort()).toEqual(['incidentDate', 'incidentId', 'severity', 'status', 'type', 'verdict']);
    const html = renderToStaticMarkup(React.createElement(EvidenceBody, {
      proofType: EVIDENCE_TYPES.INCIDENT, planStatus: null,
      data: { title: EVIDENCE_TITLES[EVIDENCE_TYPES.INCIDENT], managingModule: MANAGING_MODULE[EVIDENCE_TYPES.INCIDENT], facts },
    }));
    expect(html).toContain('2041');
    expect(html).not.toMatch(/EDSA|Engine failure|Towed/);
  });
});

// FM-DRAW-015. The GPS applicability rule now has two readers: the drawer's row
// (evidence-drawer.jsx:235) and the chat-side narration guard
// (src/lib/dispatch/narration-guards.js). The guard mirrors the predicate rather
// than importing it, so that the change stayed additive, and this test is what
// keeps the two from drifting: if either layer changes its mind about when live
// location applies, the chat and the drawer would contradict each other and this
// fails. The live probe found exactly that contradiction on 2026-09-17 - the
// drawer said "Not applicable" while the chat said "unknown".
describe('L. GPS applicability agrees between chat and drawer', () => {
  const gpsQuestion = 'What is its GPS status?';
  const shapes = [
    ['planning horizon', () => makePair()],
    ['same-day horizon', () => makePair({ temporalContext: { horizon: 'SAME_DAY', urgency: 'SAME_DAY', nextBoundaryAt: FUTURE_INSTANT() } })],
    ['repositioning mode', () => repositioningPair()],
  ];

  it('FM-DRAW-015 an inapplicable evaluation reads as not applicable on both layers', () => {
    for (const [label, build] of shapes) {
      const evidence = handoff([build()]);
      const row = buildInspectorRows(evidence.pairs[0].clearance, evidence.pairs[0].clearanceMeta).at(-1);
      expect(row, label).toMatchObject({ label: 'Current GPS', state: 'na', note: 'Not applicable' });

      const block = guardDisclosure(narrationGuards({ question: gpsQuestion, evidence }));
      expect(block, label).toContain('Live GPS was not part of this evaluation');
      // Neither layer reads the deliberate exclusion as a gap in the evidence.
      expect(block, label).not.toContain('Unknown');
    }
  });

  it('FM-DRAW-015 a supplied reading, and a genuinely absent one, agree on both layers', () => {
    // A real reading: the drawer reports it and the chat adds no clause.
    const supplied = handoff([immediatePair({ gpsHealth: 'Delayed' })]);
    expect(buildInspectorRows(supplied.pairs[0].clearance, supplied.pairs[0].clearanceMeta).at(-1))
      .toMatchObject({ label: 'GPS Health', state: 'clear', note: 'Delayed' });
    expect(narrationGuards({ question: gpsQuestion, evidence: supplied }).gpsNotApplicable).toBeNull();

    // An immediate evaluation with no reading is a real gap on both layers: the
    // drawer says unknown and the chat makes no not-applicable claim.
    const gap = handoff([immediatePair({ gpsHealth: null, liveLocationUsed: false })]);
    expect(buildInspectorRows(gap.pairs[0].clearance, gap.pairs[0].clearanceMeta).at(-1))
      .toMatchObject({ label: 'GPS Health', state: 'verify', note: 'Unknown' });
    expect(narrationGuards({ question: gpsQuestion, evidence: gap }).gpsNotApplicable).toBeNull();
  });
});
