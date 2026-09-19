import { beforeEach, describe, expect, it, vi } from 'vitest';

// Group N of the FleetMate scenario matrix: the conversation route's
// server-owned response contract. Deliberately disjoint from the existing
// route.test.js (input validation, selected-pair grounding, comparison-proof
// minting) and the SEC-AI suite (input boundary, prompt ownership, mutation
// absence). What is asserted here is the handoff the interface and the Evidence
// Drawer consume: option identity and gating, the read-only intent branches, the
// drawer payload, and the verified-baseline change narration.

vi.mock('@/lib/api/utils', () => ({
  requirePermission: vi.fn(),
  parseBody: req => req.json(),
  AuthError: class extends Error { constructor(message, status) { super(message); this.status = status; } },
  handleError: e => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/services/reservation-lifecycle.service', () => ({ loadRequest: vi.fn() }));
vi.mock('@/services/dispatch-recommendation-preparation.service', () => ({ prepareDispatchRecommendation: vi.fn() }));
vi.mock('@/services/dispatch-radar.service', () => ({ applyDispatchRadar: vi.fn(async () => {}) }));
vi.mock('@/services/dispatch-plan-evidence.service', () => ({ verifyPlanToken: vi.fn(), readPlanRevision: vi.fn(async () => 'rev-1') }));
vi.mock('@/services/dispatch-plan.service', () => ({ buildDispatchPlan: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/services/dispatch-simulate.service', () => ({ runReservationSimulation: vi.fn() }));
vi.mock('@/services/dispatch-return.service', () => ({ findReturnMatches: vi.fn() }));
vi.mock('@/lib/ai/llm-adapter', () => ({ executeLlmCompletion: vi.fn(async () => ({ success: false, fallback: true })) }));
// The route records a narration guard in ailogs. Mocked so the suite can assert
// the record without a database: vitest.config.mjs loads no environment, so a
// real logger would either warn on every guard test or - if DATABASE_URL is
// inherited from the shell - insert into the live table during a test run.
vi.mock('@/lib/ai/logger', () => ({ logAiRequest: vi.fn(async () => {}) }));

import { requirePermission } from '@/lib/api/utils';
import { logAiRequest } from '@/lib/ai/logger';
import { loadRequest } from '@/services/reservation-lifecycle.service';
import { prepareDispatchRecommendation } from '@/services/dispatch-recommendation-preparation.service';
import { buildDispatchPlan } from '@/services/dispatch-plan.service';
import { runReservationSimulation } from '@/services/dispatch-simulate.service';
import { findReturnMatches } from '@/services/dispatch-return.service';
import { makePair, blockedPair, makeRequest, exclusionOnly, repositioningPair } from '@/lib/dispatch/fleetmate-fixtures';
import { POST } from './route';

process.env.NEXTAUTH_SECRET ??= 'test-secret-for-route-scenarios';

const call = (body, id = '502') => POST(
  new Request('http://localhost/api/x/conversation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ id }) },
);

/** Two clean, confirmable candidates with distinct, checkable identities. */
const clearOne = () => makePair({ vehicle_id: 1, driver_id: 2, vehicle: { plate_number: 'ONE 01' }, driver: { driver_name: 'Ben Cruz' } });
const clearFive = () => makePair({ vehicle_id: 5, driver_id: 6, vehicle: { plate_number: 'FIVE 05' }, driver: { driver_name: 'Ana Reyes' } });
const maintenanceBlocked = () => blockedPair({ maintenance: 'Vehicle is under Preventive Maintenance during this window.' }, { vehicle_id: 5, driver_id: 6, vehicle: { plate_number: 'FIVE 05' }, driver: { driver_name: 'Ana Reyes' } });

const serve = (candidates, recommended) => prepareDispatchRecommendation.mockResolvedValue({
  recommendation: { evaluatedAt: '2026-09-17T02:00:00.000Z', pair: { candidates, recommended } },
});

// The request object the route loads. Captured rather than rebuilt per assertion
// because makeRequest() dates its pickup relative to now (fleetmate-fixtures.js:139),
// so a second call is not the same object the route saw, and could straddle midnight.
let loadedRequest;

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { employeeId: 1, email: 'd@x.test' } });
  loadedRequest = makeRequest();
  loadRequest.mockResolvedValue(loadedRequest);
  serve([clearOne(), clearFive()], { vehicle_id: 1, driver_id: 2 });
});

describe('N. Conversation route response contract', () => {
  it('FM-ROUTE-001 option identity and choosability are resolved server-side, never by card position', async () => {
    // Option 1 is the blocked pair; the engine recommends the other one.
    serve([maintenanceBlocked(), clearOne()], { vehicle_id: 1, driver_id: 2 });
    const data = await (await call({
      message: 'Why Option 1?',
      displayedOptions: [{ vehicleId: 5, driverId: 6 }, { vehicleId: 1, driverId: 2 }],
    })).json();

    expect(data.mode).toBe('evidence-only');
    // Identity follows the card, not the rank: option 1 is vehicle 5 even though
    // the engine recommends vehicle 1.
    const prompt = JSON.parse(vi.mocked((await import('@/lib/ai/llm-adapter')).executeLlmCompletion).mock.calls[0][0].user_prompt);
    expect(prompt.serverEvidence.displayedOptions).toEqual([
      { option: 1, vehicleId: 5, driverId: 6, status: 'resolved' },
      { option: 2, vehicleId: 1, driverId: 2, status: 'resolved' },
    ]);
    // Only the confirmable pair is offered, under its own card number.
    expect(data.choiceOptions).toEqual([2]);
    // The chat and the recovery payload agree on why option 1 is not offered.
    // The payload is keyed by identity too, so the dispatcher's card number is
    // not needed to find the finding.
    const blockedRecovery = data.pairRecovery.find(p => p.vehicleId === 5 && p.driverId === 6);
    expect(blockedRecovery.actions[0]).toMatchObject({ code: 'MAINTENANCE_CONFLICT', status: 'blocking' });
    expect(data.answer).toContain('Check maintenance record');
  });

  it('FM-ROUTE-002 a card that no longer matches fresh evidence stays missing, and a selection suppresses choice prompts', async () => {
    const stale = await (await call({
      message: 'Is Option 2 still available?',
      displayedOptions: [{ vehicleId: 1, driverId: 2 }, { vehicleId: 111, driverId: 222 }],
    })).json();
    const stalePrompt = JSON.parse(vi.mocked((await import('@/lib/ai/llm-adapter')).executeLlmCompletion).mock.calls.at(-1)[0].user_prompt);
    expect(stalePrompt.serverEvidence.displayedOptions[1]).toMatchObject({ option: 2, status: 'missing' });
    expect(stale.choiceOptions).toEqual([1]);
    // A missing option is refused by name rather than quietly swapped.
    expect(stale.answer).toContain('Option 2 is no longer in the current evidence');

    // With a resolved selection the interface owns the choice prompt.
    const selected = await (await call({ message: 'Why this pair?', selectedPair: { vehicleId: 5, driverId: 6 } })).json();
    expect(selected.selection).toEqual({ vehicleId: 5, driverId: 6, status: 'resolved' });
    expect(selected.choiceOptions).toEqual([]);
  });

  it('FM-ROUTE-003 the drawer payload the route returns matches what the chat narrated', async () => {
    serve([maintenanceBlocked(), clearOne()], { vehicle_id: 5, driver_id: 6 });
    const data = await (await call({ message: 'Why is this blocked?' })).json();

    expect(data.pairRecovery).toHaveLength(2);
    const blocked = data.pairRecovery.find(p => p.vehicleId === 5);
    expect(blocked.meta).toMatchObject({ horizon: 'FUTURE', driverName: 'Ana Reyes', plate: 'FIVE 05', vehicleId: 5, driverId: 6 });
    // Same check label and the same blocking state the answer narrated, with no
    // clearance proof offered for a check that did block.
    const maintenance = blocked.clearance.find(c => c.checkId === 'maintenance');
    expect(maintenance).toMatchObject({ label: 'Service-window maintenance', status: 'blocking', proof: null });
    expect(blocked.actions[0]).toMatchObject({ code: 'MAINTENANCE_CONFLICT', status: 'blocking' });
    expect(data.answer).toContain('Vehicle is under Preventive Maintenance during this window.');
    // A pair with no recorded conflict says so rather than inventing one.
    expect(data.answer).toContain('No specific conflict finding is recorded in this response.');
    // Read-only: the route returns no mutation surface of any kind.
    expect(Object.keys(data).sort()).toEqual([
      'answer', 'baselineStatus', 'changes', 'choiceOptions', 'comparisonProof', 'coverage',
      'evaluatedAt', 'intent', 'mode', 'pairRecovery', 'recoveryActions', 'selection', 'snapshot',
    ]);
  });

  it('FM-ROUTE-004 a verified baseline narrates only evidence-backed changes, and says so when there are none', async () => {
    const activeReview = { displayedOptions: [{ vehicleId: 1, driverId: 2 }] };
    const first = await (await call({ message: 'What changed?', ...activeReview })).json();
    expect(first.baselineStatus).toBe('none');
    expect(typeof first.snapshot).toBe('string');

    // Same evidence, verified baseline: no material change, stated plainly.
    const unchanged = await (await call({ message: 'What changed?', baseline: first.snapshot, ...activeReview })).json();
    expect(unchanged.baselineStatus).toBe('verified');
    expect(unchanged.changes.changed).toBe(false);
    expect(unchanged.answer).toBe('No material change since the last verified evaluation.');

    // The pair the baseline recorded is now blocked: the change is narrated from
    // the diff, with both values drawn from server evidence.
    serve([maintenanceBlocked(), clearOne()], { vehicle_id: 5, driver_id: 6 });
    const changed = await (await call({ message: 'What changed?', baseline: first.snapshot, ...activeReview })).json();
    expect(changed.baselineStatus).toBe('verified');
    expect(changed.changes.changed).toBe(true);
    expect(changed.changes.changes.some(c => c.type === 'eligibility' && c.after === 'BLOCKED')).toBe(true);
    expect(changed.answer).toMatch(/changed from ALL_CLEAR to BLOCKED|is no longer in the evaluation/);
    expect(changed.answer).not.toContain('No material change');
  });

  it('FM-ROUTE-005 the queue-impact path runs only for two resolved options, and reads the queue for those two identities', async () => {
    const insufficient = await (await call({ message: 'How does this affect other bookings?', displayedOptions: [{ vehicleId: 1, driverId: 2 }] })).json();
    expect(insufficient.intent).toMatchObject({ type: 'impact', status: 'needs-options' });
    // No queue run for an incomplete comparison — the read-only path degrades
    // instead of scoring a single option.
    expect(buildDispatchPlan).not.toHaveBeenCalled();

    const compared = await (await call({
      message: 'How does this affect other bookings?',
      displayedOptions: [{ vehicleId: 5, driverId: 6 }, { vehicleId: 1, driverId: 2 }],
    })).json();
    expect(compared.intent).toMatchObject({ type: 'impact', status: 'ok' });
    expect(buildDispatchPlan).toHaveBeenCalledTimes(2);
    // Each run is bound to a card identity, in card order — never to the rank.
    expect(buildDispatchPlan.mock.calls.map(c => c[0].selection)).toEqual([
      { requestId: 502, vehicleId: 5, driverId: 6 },
      { requestId: 502, vehicleId: 1, driverId: 2 },
    ]);
    // Bound to the loaded request's pickup date, never to the clock. Derived
    // rather than written as a literal: the fixture dates its pickup relative to
    // now, so a hardcoded day is green only on the day it was written. This line
    // read '2026-09-18' and failed the next morning - a date-relative fixture
    // meeting a fixed expectation, which is a trap this repo has hit before.
    expect(buildDispatchPlan.mock.calls.every(c => c[0].date === String(loadedRequest.pickup_datetime).slice(0, 10))).toBe(true);
  });

  it('FM-ROUTE-006 a return search needs a server pair and offers follow-ons as suggestions, never assignments', async () => {
    serve([], null);
    const noPair = await (await call({ message: 'Find a return booking' })).json();
    expect(noPair.intent).toMatchObject({ type: 'return', status: 'needs-pair' });
    expect(findReturnMatches).not.toHaveBeenCalled();

    serve([clearOne(), clearFive()], { vehicle_id: 1, driver_id: 2 });
    findReturnMatches.mockResolvedValue({ matches: [{ requestId: 611 }], note: null });
    const found = await (await call({ message: 'Find a return booking' })).json();
    expect(found.intent).toMatchObject({ type: 'return', status: 'ok' });
    // The recommended pair is the server's, not one from the chat.
    expect(findReturnMatches.mock.calls[0][0]).toMatchObject({ outboundId: 502, vehicleId: 1, driverId: 2 });
    expect(found.answer).toBe('Possible follow-on: request #611. Review each in its own conversation before assigning.');
    expect(found.answer).not.toMatch(/assigned|booking confirmed/i);
  });

  it('FM-ROUTE-007 a simulation is reported as a simulation, and a failed one never invents a result', async () => {
    runReservationSimulation.mockResolvedValue({
      interpreted: { pickupLocal: 'Sep 18, 2026, 7:00 PM', passengerCount: 4 },
      options: [{ vehicleId: 1, driverId: 2, plate: 'ONE 01', state: 'ALL_CLEAR' }],
    });
    const ok = await (await call({ message: 'What if pickup is 7 PM on Sep 18 for 4 passengers?' })).json();
    expect(ok.intent).toMatchObject({ type: 'simulate', status: 'ok' });
    expect(ok.answer).toContain('Simulation — reservation unchanged.');
    expect(ok.answer).toContain('ONE 01 / driver #2: ALL_CLEAR.');
    expect(ok.answer).toMatch(/reservation unchanged/i);
    expect(ok.answer).not.toMatch(/assigned|confirmed|will be booked/i);
    // A simulation is never a selection and never offers a choice.
    expect(ok.selection).toBeNull();
    expect(ok.choiceOptions).toEqual([]);

    runReservationSimulation.mockRejectedValue(new Error('Simulation service unavailable.'));
    const failed = await (await call({ message: 'What if pickup is 7 PM on Sep 18 for 4 passengers?' })).json();
    expect(failed.intent).toMatchObject({ type: 'simulate', status: 'error' });
    expect(failed.answer).toBe('That comparison is currently unavailable. The current findings above still stand.');
    expect(failed.answer).not.toMatch(/ALL_CLEAR|proposed:/i);
  });
});

// FM-ROUTE-008. Regression for a live-model defect observed 2026-09-17: with 18
// candidates and 35 exclusions projected down to 12 and 30, the live model
// disclosed the bound in one sample and omitted it in the next. The prompt gave
// it two contradictory rules — SELECTION_INSTRUCTIONS said to disclose the
// truncation, CONVERSATION_STYLE forbade evaluation counts — so the outcome was
// a sampling decision. The route now owns the sentence, which makes the
// property deterministic and assertable here rather than only by live sampling.
describe('N. Evaluated-window disclosure is server-owned', () => {
  const CANDIDATES = () => Array.from({ length: 18 }, (_, i) => makePair({ vehicle_id: i + 1, driver_id: i + 1 }));
  const EXCLUSIONS = () => Array.from({ length: 35 }, (_, i) =>
    exclusionOnly(50 + i, 'Vehicle status is Under Maintenance.', { prefiltered: true }));

  const serveTruncated = () => prepareDispatchRecommendation.mockResolvedValue({
    recommendation: {
      evaluatedAt: '2026-09-17T02:00:00.000Z',
      pair: { candidates: CANDIDATES(), recommended: { vehicle_id: 1, driver_id: 1 }, none_reasons: EXCLUSIONS() },
    },
  });

  const narrate = async (content) => {
    const { executeLlmCompletion } = await import('@/lib/ai/llm-adapter');
    vi.mocked(executeLlmCompletion).mockResolvedValueOnce({ success: true, content });
    return (await call({ message: 'Is anything available?' })).json();
  };

  it('FM-ROUTE-008 a narrated answer that omits the bound still discloses it', async () => {
    serveTruncated();
    const data = await narrate('Twelve driver-vehicle pairs passed the full checks.');

    expect(data.mode).toBe('conversation');
    // The model's prose is kept, not replaced.
    expect(data.answer).toContain('Twelve driver-vehicle pairs passed the full checks.');
    // The server states the bound the model left out.
    expect(data.answer).toContain('Limited context: 12 of 18 candidate pairs and 30 of 35 exclusions in this evaluation.');
    expect(data.coverage).toMatchObject({
      pairs: { total: 18, included: 12, truncated: true },
      exclusions: { total: 35, included: 30, truncated: true },
    });
  });

  it('FM-ROUTE-008 a model that states the bound itself is not made to say it twice', async () => {
    serveTruncated();
    const data = await narrate('Twelve of 18 pairs and 30 of 35 exclusions were evaluated.');

    expect(data.answer).toContain('Twelve of 18 pairs and 30 of 35 exclusions were evaluated.');
    expect(data.answer).not.toContain('Limited context:');
    expect(data.answer.match(/18/g)).toHaveLength(1);
  });

  it('FM-ROUTE-008 an untruncated evaluation adds no disclosure', async () => {
    // beforeEach already serves two clean candidates and no exclusions.
    const data = await narrate('Two pairs passed the full checks.');

    expect(data.answer).toBe('Two pairs passed the full checks.');
    expect(data.answer).not.toContain('Limited context:');
  });
});

// FM-ROUTE-009. The narration guards are the route-level half of the same fix as
// FM-ROUTE-008: an obligation that is a closed fact about (question, evidence) is
// stated by the server instead of being left to model sampling. The live probe
// (2026-09-17, 20 deepseek-chat calls) showed the model gets these right most of
// the time and cannot be relied on to get them right every time; the clauses
// append to the narrated answer only, so the deterministic path the scenario
// suite pins is untouched and the model's prose is still returned verbatim.
describe('N. Narration guards append to the narrated answer', () => {
  const narrate = async (content, body) => {
    const { executeLlmCompletion } = await import('@/lib/ai/llm-adapter');
    vi.mocked(executeLlmCompletion).mockResolvedValueOnce({ success: true, content });
    return (await call({ displayedOptions: [{ vehicleId: 1, driverId: 1 }], ...body })).json();
  };

  it('FM-ROUTE-009 a GPS question on an inapplicable evaluation gains the server clause and keeps the prose', async () => {
    serve([repositioningPair()], { vehicle_id: 1, driver_id: 1 });
    const live = "GPS status isn't supplied for this evaluation, so it's unknown - not offline or no signal.";
    const data = await narrate(live, { message: 'What is its GPS status?' });

    expect(data.mode).toBe('conversation');
    // The model's words are kept, not replaced (SEC-AI-007).
    expect(data.answer).toContain(live);
    expect(data.answer).toContain('Live GPS was not part of this evaluation');
    // Guards add no response field, so the contract the drawer consumes is the
    // same 13 keys FM-ROUTE-003 pins.
    expect(Object.keys(data).sort()).toEqual([
      'answer', 'baselineStatus', 'changes', 'choiceOptions', 'comparisonProof', 'coverage',
      'evaluatedAt', 'intent', 'mode', 'pairRecovery', 'recoveryActions', 'selection', 'snapshot',
    ]);
    // Recorded for observability, as a flag rather than an AI error.
    expect(logAiRequest).toHaveBeenCalledTimes(1);
    expect(logAiRequest.mock.calls[0][0]).toMatchObject({
      feature_used: 'Dispatch Copilot conversation', provider_name: 'Narration Guard',
      model_name: 'Deterministic Guard', status: 'Flagged', user_email: 'd@x.test',
    });
    expect(logAiRequest.mock.calls[0][0].error_message).toContain('gps-not-applicable');
  });

  it('FM-ROUTE-009 several guards on one turn append together and are all recorded', async () => {
    serve([repositioningPair()], { vehicle_id: 1, driver_id: 1 });
    const data = await narrate('Vehicle 99 is not something I can see here.', {
      message: 'Is vehicle 99 available? Is that guaranteed?',
    });

    expect(data.answer).toContain('Vehicle 99 is not something I can see here.');
    expect(data.answer).toContain('vehicle 99 is not in this evaluation');
    expect(data.answer).toContain('does not rate the odds of a trip succeeding');
    expect(logAiRequest).toHaveBeenCalledTimes(1);
    expect(logAiRequest.mock.calls[0][0].error_message)
      .toContain('absent-entities:vehicle 99');
    expect(logAiRequest.mock.calls[0][0].error_message)
      .toContain('rate-or-promise-sought');
  });

  it('FM-ROUTE-009 an ordinary question narrates unchanged and writes no flag', async () => {
    const data = await narrate('Two pairs passed the full checks.', { message: 'Why is this pair blocked?' });

    expect(data.answer).toBe('Two pairs passed the full checks.');
    expect(logAiRequest).not.toHaveBeenCalled();
  });

  it('FM-ROUTE-009 a claim the model volunteers is guarded though the question never asked', async () => {
    // Case 18's shape at the route: the question is neutral, so no question-side
    // guard can fire. Only the output-side guard can, and the model's prose is
    // still returned verbatim.
    const live = 'It should arrive on time - I would put it at about 90%.';
    const data = await narrate(live, { message: 'Summarize the situation in two sentences.' });

    expect(data.answer).toContain(live);
    expect(data.answer).toContain('does not rate the odds of a trip succeeding');
    expect(logAiRequest).toHaveBeenCalledTimes(1);
    expect(logAiRequest.mock.calls[0][0]).toMatchObject({ status: 'Flagged' });
    expect(logAiRequest.mock.calls[0][0].error_message).toContain('rate-or-promise-volunteered');
  });

  it('FM-ROUTE-009 a volunteered GPS claim is guarded on a neutral question too', async () => {
    serve([repositioningPair()], { vehicle_id: 1, driver_id: 1 });
    const live = "The vehicle's GPS is offline, so tracking has dropped.";
    const data = await narrate(live, { message: 'What should I check next?' });

    expect(data.answer).toContain(live);
    expect(data.answer).toContain('Live GPS was not part of this evaluation');
    expect(logAiRequest).toHaveBeenCalledTimes(1);
    expect(logAiRequest.mock.calls[0][0].error_message).toContain('gps-volunteered');
  });

  it('FM-ROUTE-009 a refusal is not a claim, so the answer is delivered byte-identical', async () => {
    // The false-positive regression at the route. The model correctly declining a
    // rate names the banned token; clause polarity is what keeps the guard silent,
    // and with nothing appended the dispatcher receives the model's own words.
    const live = "I can't give a success probability or a punctuality guarantee - the server doesn't produce either.";
    const data = await narrate(live, { message: 'Summarize the situation in two sentences.' });

    expect(data.answer).toBe(live);
    expect(logAiRequest).not.toHaveBeenCalled();
  });

  it('FM-ROUTE-009 the deterministic answer path carries no guard clause and writes no flag', async () => {
    // beforeEach's default adapter result is the unavailable-provider shape, so
    // this is the evidence-only fallback the scenario suite pins.
    const data = await call({ message: 'Is vehicle 99 available? Is that guaranteed?' }).then(r => r.json());

    expect(data.mode).toBe('evidence-only');
    expect(data.answer).not.toContain('not in this evaluation');
    expect(data.answer).not.toContain('does not rate the odds');
    expect(logAiRequest).not.toHaveBeenCalled();
  });
});
