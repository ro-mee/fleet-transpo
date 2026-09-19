import { it, expect } from 'vitest';
import { classifyCopilotScope, detectCopilotIntent, parseSimulationScenario } from './copilot-intents';

const inScope = (message, history = [], options = {}) =>
  classifyCopilotScope(message, history, options).kind === 'in-scope';

it.each([
  'Why is Driver 12 unavailable?',
  'Compare Option 1 and Option 2.',
  "What's the ETA?",
  'Does this vehicle have enough seats?',
  'Why did maintenance block this vehicle?',
  'Explain what preventive maintenance means generally.',
  'The guest works for a movie studio; which vehicle should we assign?',
  'Why is the ETA different?',
])('classifies direct FleetOps questions as in scope: %s', message => {
  expect(inScope(message)).toBe(true);
});

it.each(['Hi', 'Thanks', 'Good morning'])('classifies courtesies separately: %s', message => {
  expect(classifyCopilotScope(message).kind).toBe('courtesy');
});

it.each([
  'Why?',
  'How about the other one?',
  'What changed?',
  'Tomorrow?',
  'Compare them.',
])('keeps contextual follow-ups in scope after a FleetOps turn: %s', message => {
  const history = [{ role: 'user', content: 'Why is Driver 12 unavailable?' }];
  expect(inScope(message, history)).toBe(true);
});

it('allows an ambiguous follow-up when an active recommendation is present', () => {
  expect(inScope('Why?', [], { hasActiveContext: true })).toBe(true);
});

it('does not treat a bare route or generic weather question as FleetOps context', () => {
  expect(classifyCopilotScope('Why?').kind).toBe('out-of-scope');
  expect(classifyCopilotScope("What's the weather today?").kind).toBe('out-of-scope');
  expect(inScope('Will weather affect this booking?')).toBe(true);
  expect(inScope('What about traffic?', [{ role: 'user', content: 'Why is Driver 12 unavailable?' }])).toBe(true);
});

it('does not inherit FleetOps context after an unrelated turn', () => {
  const history = [{ role: 'user', content: 'Recommend a movie.' }];
  expect(classifyCopilotScope('Why?', history, { hasActiveContext: true }).kind).toBe('out-of-scope');
  expect(classifyCopilotScope('What changed?', history, { hasActiveContext: true }).kind).toBe('out-of-scope');

  const weatherHistory = [
    { role: 'user', content: 'Why is Driver 12 unavailable?' },
    { role: 'user', content: "What's the weather today?" },
  ];
  expect(classifyCopilotScope('Why?', weatherHistory, { hasActiveContext: true }).kind).toBe('out-of-scope');
});

it('returns to FleetOps scope only after an explicit FleetOps question', () => {
  const history = [{ role: 'user', content: 'Recommend a movie.' }];
  expect(classifyCopilotScope('Why is the ETA different?', history).kind).toBe('in-scope');
  expect(classifyCopilotScope('Why?', [...history, { role: 'user', content: 'Why is the ETA different?' }]).kind).toBe('in-scope');
});

it.each([
  'Recommend a movie.',
  'Who should I vote for?',
  'Solve my calculus homework.',
  'Write Python code for my unrelated project.',
  'Write code to calculate ETA for this booking.',
  "What's the capital of France?",
])('classifies unrelated requests as out of scope: %s', message => {
  expect(classifyCopilotScope(message).kind).toBe('out-of-scope');
});

it('detects only clear simulation/impact/return intents', () => {
  expect(detectCopilotIntent('What if pickup is 7 PM?')?.type).toBe('simulate');
  expect(detectCopilotIntent('How does this affect other bookings?')?.type).toBe('impact');
  expect(detectCopilotIntent('Find a return booking')?.type).toBe('return');
  expect(detectCopilotIntent('Why this pair?')).toBeNull();
  expect(detectCopilotIntent('Any conflicts?')).toBeNull();
});

it('parses time and pax but never guesses a date', () => {
  const r = parseSimulationScenario('What if pickup is 7 PM?', { now: new Date('2026-09-17T08:00:00+08:00') });
  expect(r).toMatchObject({ needsClarification: 'date' });
  const dated = parseSimulationScenario('What if pickup is 7 PM on Sep 18 for 4 passengers?', { now: new Date('2026-09-17T08:00:00+08:00') });
  expect(dated.pickup_datetime).toBe('2026-09-18T19:00:00+08:00');
  expect(dated.passenger_count).toBe(4);
  expect(parseSimulationScenario('Why no match?')).toBeNull();
  expect(parseSimulationScenario('What if we bring 99 passengers?')?.passenger_count).toBeNull();
});
