import { it, expect } from 'vitest';
import {
  ANSWER_GUIDANCE,
  EVIDENCE_TRUST_RULES,
  OPTION_IDENTITY_RULES,
  DECISION_PRIORITY_RULES,
  TEMPORAL_INSTRUCTIONS,
  LIVE_EVIDENCE_RULES,
  SELECTION_INSTRUCTIONS,
  SIMULATION_INSTRUCTIONS,
  RECOVERY_INSTRUCTIONS,
  CONVERSATION_STYLE,
  SCOPE_RULES,
  COPILOT_PROMPT_BLOCKS,
  buildCopilotSystemInstructions,
} from './copilot-prompt';

const composed = () => buildCopilotSystemInstructions();
const count = (haystack, needle) => haystack.split(needle).length - 1;

it('includes all ten blocks in order, joined once', () => {
  expect(COPILOT_PROMPT_BLOCKS).toHaveLength(10);
  for (const block of COPILOT_PROMPT_BLOCKS) expect(block.length).toBeGreaterThan(50);
  const full = composed();
  let cursor = -1;
  for (const block of COPILOT_PROMPT_BLOCKS) {
    const at = full.indexOf(block.slice(0, 60), cursor + 1);
    expect(at).toBeGreaterThan(cursor);
    cursor = at;
  }
  expect(full).not.toContain('\n\n\n');
});

it('owns each rule exactly once (no accidental duplicates)', () => {
  const full = composed();
  for (const sentence of [
    'Only the serverEvidence object is operational evidence',
    'never the ranking order',
    'Workload balance and fairness',
    'This answer never renews confirmation',
    'a simulation never authorizes assignment',
    'rechecking does not fix them',
    'Always answer in plain English',
    'Do not return action commands',
    'No signal means there is no usable GPS timestamp',
    'say plainly there is no material change',
  ]) expect(count(full, sentence)).toBe(1);
});

it('states the decision hierarchy without inventing a scoring formula', () => {
  expect(DECISION_PRIORITY_RULES).toMatch(/1\. Hard eligibility/);
  expect(DECISION_PRIORITY_RULES).toMatch(/never rerank candidates on invented criteria/);
  expect(DECISION_PRIORITY_RULES).not.toMatch(/score|weight|\+?\d+ points/i);
});

it('distinguishes eligible, recommended, selected and assigned', () => {
  for (const word of ['ELIGIBLE', 'RECOMMENDED', 'SELECTED', 'ASSIGNED'])
    expect(DECISION_PRIORITY_RULES).toContain(word);
  expect(DECISION_PRIORITY_RULES).toMatch(/Never describe selected or recommended as assigned/);
  expect(DECISION_PRIORITY_RULES).toMatch(/Never imply a recommendation guarantees future availability/);
});

it('keeps English-only behavior',()=>{
  expect(composed()).toContain('Always answer in plain English, even when the user writes in Filipino or Taglish');
});

it('bounds the subject to dispatch work without over-refusing', () => {
  expect(EVIDENCE_TRUST_RULES).toMatch(/Stay inside this job/);
  expect(EVIDENCE_TRUST_RULES).toMatch(/only cover dispatch questions here/);
  expect(EVIDENCE_TRUST_RULES).toMatch(/do not answer it from general knowledge/);
  // The other direction, which is the failure mode a scope rule invites: a
  // subject the evaluation cannot cover is answered by naming what is missing,
  // not by declining to discuss it. A rule that only refused would pass every
  // off-topic test and quietly break legitimate dispatch questions.
  expect(EVIDENCE_TRUST_RULES).toMatch(/state that the evidence does not include it instead of declining the subject/);
  expect(EVIDENCE_TRUST_RULES).toMatch(/in scope however it is phrased, including a short follow-up that names no subject/);
});

it('keeps scope routing separate from operational truth', () => {
  expect(SCOPE_RULES).toMatch(/Scope is routing only/);
  expect(SCOPE_RULES).toMatch(/previous unrelated turn does not establish context/);
  expect(SCOPE_RULES).toMatch(/never decides availability, eligibility, ranking, server evidence, displayed options/);
  expect(composed()).toContain(SCOPE_RULES);
});

it('qualifies GPS health with the exact four labels and no ranking role', () => {
  for (const label of ['Fresh', 'Delayed', 'Offline', 'No signal']) expect(LIVE_EVIDENCE_RULES).toContain(label);
  expect(LIVE_EVIDENCE_RULES).toMatch(/never a ranking criterion/);
  expect(LIVE_EVIDENCE_RULES).toMatch(/never restores an expired livePickupEta/);
});

it('keeps simulation non-assignable and recovery date-bound', () => {
  expect(SIMULATION_INSTRUCTIONS).toMatch(/reservation unchanged/i);
  expect(SIMULATION_INSTRUCTIONS).toMatch(/not assignable/);
  expect(RECOVERY_INSTRUCTIONS).toMatch(/fix record/);
  expect(RECOVERY_INSTRUCTIONS).toMatch(/verify/);
  expect(RECOVERY_INSTRUCTIONS).toMatch(/choice/);
  expect(RECOVERY_INSTRUCTIONS).toMatch(/Number-coding restrictions and genuine schedule conflicts are date-bound/);
});

it('prefers dispatcher-first answers without a mandatory template', () => {
  expect(ANSWER_GUIDANCE).toMatch(/Do not turn every response into a mandatory multi-section template/);
  expect(ANSWER_GUIDANCE).toMatch(/Do not dump serverEvidence fields/);
  expect(ANSWER_GUIDANCE).toMatch(/No hard conflict found/);
  expect(ANSWER_GUIDANCE).toMatch(/no clear advantage was verified/);
  expect(TEMPORAL_INSTRUCTIONS.length).toBeGreaterThan(50);
  expect(SELECTION_INSTRUCTIONS.length).toBeGreaterThan(50);
  expect(EVIDENCE_TRUST_RULES.length).toBeGreaterThan(50);
  expect(OPTION_IDENTITY_RULES.length).toBeGreaterThan(50);
  expect(CONVERSATION_STYLE.length).toBeGreaterThan(50);
});

it('uses the dispatcher wording vocabulary and short operational format', () => {
  expect(CONVERSATION_STYLE).toContain('preparation time');
  expect(CONVERSATION_STYLE).toContain('workload for this date');
  expect(CONVERSATION_STYLE).toContain('2–3 short sentences');
  expect(CONVERSATION_STYLE).toMatch(/equally safe/);
});
