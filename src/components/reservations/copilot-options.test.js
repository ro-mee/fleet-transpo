import { expect, it } from 'vitest';
import { deriveOptions, optionKey, resolveRememberedOption } from './copilot-options';

// The restore path in the panel cannot be exercised by a test in this repo: every
// component test here uses renderToStaticMarkup, which never runs effects, and the
// panel's restore is an effect. So the decision it makes — which option a
// remembered choice resolves to — lives in resolveRememberedOption, pure and
// testable, and the effect is left as wiring. These tests are the teeth for it.

const pair = (vehicle_id, driver_id, plate = `PAIR-${vehicle_id}`) => ({
  vehicle_id,
  driver_id,
  vehicle: { plate_number: plate },
  driver: { driver_name: `Driver ${vehicle_id}` },
  checks: [{ id: 'capacity', label: 'Capacity', status: 'verified' }],
  readiness: 'VERIFIED',
  feasibility: { verdict: 'SAFE' },
  reasons: [],
});

const a = pair(1, 2, 'PAIR-A');
const b = pair(3, 4, 'PAIR-B');
// Mirrors the panel's deriveFor: the same derivation for the render path and the
// restore path, differing only in the pin.
const deriveWith = (candidates, recommended) => (pinned = null) =>
  deriveOptions({ candidates, recommended, pinnedKeys: pinned });

it('resolves a remembered key against the same derivation that produced it', () => {
  const derive = deriveWith([a, b], a);
  expect(resolveRememberedOption({ key: optionKey(b), pinnedKeys: [optionKey(a), optionKey(b)] }, derive))
    .toMatchObject({ key: '3:4', index: 1, unavailable: false });
});

it('keeps the option number the dispatcher saw when the ranking has moved', () => {
  // PAIR-A was recommended when the choice was made; now the engine prefers
  // PAIR-B. Without the pin, PAIR-A would silently become Option 2 — a different
  // card number in the same conversation.
  const before = deriveWith([a, b], a);
  expect(before().map(o => o.key)).toEqual(['1:2', '3:4']);
  const afterTheRankingMoved = deriveWith([a, b], b);
  expect(afterTheRankingMoved().map(o => o.key)).toEqual(['3:4', '1:2']);
  expect(resolveRememberedOption({ key: '1:2', pinnedKeys: ['1:2', '3:4'] }, afterTheRankingMoved))
    .toMatchObject({ key: '1:2', index: 0 });
});

it('still resolves a pair that is no longer a candidate, as an unavailable option', () => {
  // The vehicle was grounded or the driver went on leave. Dropping the card would
  // lose the choice silently; resolving it as unavailable lets the selection check
  // refuse it and the decision text say why.
  const derive = deriveWith([b], b);
  expect(resolveRememberedOption({ key: '1:2', pinnedKeys: ['1:2'] }, derive))
    .toMatchObject({ key: '1:2', unavailable: true, pair: { vehicle_id: 1, driver_id: 2, unavailable: true } });
});

it('resolves nothing when there is no usable record to restore', () => {
  const derive = deriveWith([a, b], a);
  expect(resolveRememberedOption(null, derive)).toBeNull();
  expect(resolveRememberedOption(undefined, derive)).toBeNull();
  expect(resolveRememberedOption({}, derive)).toBeNull();
  expect(resolveRememberedOption({ key: 42 }, derive)).toBeNull();
  // Without a pin the derivation is today's list, so a pair the engine no longer
  // offers cannot come back.
  expect(resolveRememberedOption({ key: '9:9' }, derive)).toBeNull();
  expect(resolveRememberedOption({ key: '1:2' }, null)).toBeNull();
  expect(resolveRememberedOption({ key: '1:2', pinnedKeys: [] }, derive))
    .toMatchObject({ key: '1:2', index: 0 });
});
