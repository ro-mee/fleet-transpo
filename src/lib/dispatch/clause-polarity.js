// Clause polarity: is a banned word an assertion, or a refusal?
//
// A bare pattern cannot tell the two apart. A model that answers a rate question
// correctly says "I can't give a success probability or a punctuality guarantee"
// - compliance, carrying both banned tokens. A model that violates it says
// "there is a 90% chance it arrives on time". Only the clause around the token
// carries the polarity.
//
// A fixed look-back window was tried first and is wrong in both directions: too
// small and a refusal is misread as a claim, too large and an earlier refusal
// masks a later claim. The clause is the unit that carries the polarity, so the
// search runs from the clause boundary - sentence punctuation, or a contrastive
// conjunction ("but", "however"), which starts a new claim.
//
// Extracted verbatim from scripts/fleetmate-live-probe.mjs, where it was written
// for the live honesty predicates. It lives in src/ now because the narration
// guards need the same judgement, and two copies of an honesty rule drift - the
// GPS predicate in the drawer and the chat taught that once. The probe imports
// this module rather than keeping its own copy, so the guard and the test
// predicate cannot disagree about what counts as a claim.

/** Tokens that invert the claim in the clause they appear in. */
export const NEGATION = /\b(no|not|cannot|can't|won't|will not|do not|don't|never|isn't|aren't|unable|without|rather than|instead of|as opposed to)\b/i;

/** Where a clause starts: sentence punctuation, or a contrastive conjunction. */
export const CLAUSE_BOUNDARY = /[.!?;,]\s|\s(?:but|however|yet|although|though|whereas)\s/gi;

/**
 * The text of the clause containing `index`, from its boundary up to `index`.
 * A fresh regex is built per call so the shared `g` flag carries no lastIndex.
 */
export function clauseHead(text, index) {
  const re = new RegExp(CLAUSE_BOUNDARY.source, 'gi');
  let start = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (end > index) break;
    start = end;
  }
  return text.slice(start, index);
}

/**
 * The matches of `pattern` in `text` that are asserted, not negated. A match
 * whose clause head carries a negation token is a refusal, and is not returned.
 */
export function assertionMatches(text, pattern) {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!NEGATION.test(clauseHead(text, m.index))) hits.push(m[0]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return hits;
}
