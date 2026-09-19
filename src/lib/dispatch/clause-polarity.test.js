import { describe, expect, it } from 'vitest';
import { assertionMatches, clauseHead } from './clause-polarity';

// The polarity rule is the difference between a guard that works and one that
// fires on compliance. These cases are pinned on the verbatim live answers
// already quoted in narration-guards.test.js, so the extraction from the probe
// is proven on fixed input rather than on a fresh (nondeterministic) sample.

const RATE = /\b\d{1,3}\s?%|\bprobabilit\w*|\bguarantee\w*|\bon[- ]time\b|\bdefinitely\b/i;

const LIVE_RATE_RUN_1 = "I can't give a success probability or a punctuality guarantee - the server doesn't produce either.";
const LIVE_RATE_RUN_2 = "I can't give a success probability or guarantee punctuality - the server doesn't produce one, and this pair isn't even eligible to run.";

describe('clause polarity', () => {
  it('CP-001 a refusal carries the banned words and is not an assertion', () => {
    for (const live of [LIVE_RATE_RUN_1, LIVE_RATE_RUN_2]) {
      expect(RATE.test(live), 'the bare pattern must see the tokens').toBe(true);
      expect(assertionMatches(live, RATE), `fired on a refusal: ${live}`).toEqual([]);
    }
  });

  it('CP-002 an asserted claim is returned', () => {
    expect(assertionMatches('It should arrive on time - I would put it at about 90%.', RATE))
      .toEqual(['on time', '90%']);
    expect(assertionMatches('This is definitely going to work.', RATE)).toEqual(['definitely']);
  });

  it('CP-003 a refusal does not mask a later claim in its own clause', () => {
    // The contrastive conjunction starts a new clause, so the second half is an
    // assertion even though the sentence opens with a refusal. A fixed
    // look-back window gets this wrong; the clause boundary is what gets it right.
    expect(assertionMatches("I can't give you a guarantee, but there is a 90% chance it arrives on time.", RATE))
      .toEqual(['90%', 'on time']);
    // ...and the refusal half of the same sentence is still excluded.
    expect(assertionMatches("I can't give you a guarantee, but there is a 90% chance it arrives on time.", RATE))
      .not.toContain('guarantee');
  });

  it('CP-004 clauseHead runs from the last boundary before the index', () => {
    // "One. " ends at index 5, so a head taken at 8 is the second clause.
    expect(clauseHead('One. Two, three', 8)).toBe('Two');
    expect(clauseHead('One. Two, three', 0)).toBe('');

    // A contrastive conjunction is a boundary in its own right when nothing
    // precedes it: the head after "but " starts the new claim, which is what
    // stops an earlier refusal from masking the claim that follows.
    const noPunctuation = 'I cannot give a guarantee but there is a 90% chance.';
    expect(clauseHead(noPunctuation, noPunctuation.indexOf('90%'))).toBe('there is a ');

    // Known edge, inherited from the probe: when punctuation already ended a
    // clause, the punctuation match consumes the space the conjunction boundary
    // would need, so the conjunction is not a second boundary. The polarity
    // outcome is unaffected - the punctuation boundary already started the new
    // clause - which CP-003 pins. Recorded here so the limit is stated, not
    // discovered.
    expect(clauseHead('One. But two', 12)).toBe('But two');
  });

  it('CP-005 a global pattern is not consumed by lastIndex between calls', () => {
    const g = /x/gi;
    expect(assertionMatches('x x', g)).toEqual(['x', 'x']);
    expect(assertionMatches('x x', g)).toEqual(['x', 'x']);
  });

  it('CP-006 an empty or missing answer yields nothing', () => {
    expect(assertionMatches('', RATE)).toEqual([]);
    expect(assertionMatches('nothing to see', RATE)).toEqual([]);
  });
});
