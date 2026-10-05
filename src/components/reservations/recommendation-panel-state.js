import { optionKey } from "./copilot-options";

export function recommendationStatusLabel({ queryError, stale, checking, incomplete }) {
  if (checking) return "Checking";
  if (queryError) return "Unavailable";
  if (incomplete) return "Incomplete";
  if (stale) return "Stale";
  return "Evidence";
}

export function canRestoreRememberedSelection({ requestId, isClosed, queryError, completedRecommendation, optionCount }) {
  return Boolean(requestId && !isClosed && !queryError && completedRecommendation && optionCount > 0);
}

export function isCompletedRecommendation(recommendation) {
  return Boolean(
    recommendation?.evaluatedAt &&
    Array.isArray(recommendation?.pair?.candidates) &&
    recommendation?.candidateEvaluationComplete !== false &&
    recommendation?.pair?.candidateEvaluationComplete !== false
  );
}

/** Allow checking from current evidence or a caller-validated fresh recommendation. */
export function canStartSelectionCheck({
  currentRecommendation,
  recommendationRefreshed,
  assignmentPending,
  failureChecking,
  unavailable,
  blocked,
}) {
  return Boolean(
    (currentRecommendation || recommendationRefreshed) &&
    !assignmentPending &&
    !failureChecking &&
    !unavailable &&
    !blocked
  );
}

/**
 * Recheck ordering contract:
 * 1. Invalidate old selection-check state before `query.refetch()`.
 * 2. Only the refreshed response determines whether recommendation evidence is
 *    complete/current; a prior error or incomplete response may have recovered.
 * 3. `resolveCurrentOption(data, selectionKey)` returns `{ option, pinnedKeys }`
 *    only when that selected pair remains current/selectable, otherwise `null`.
 * 4. `chooseOption` receives the fresh option, announcement, and
 *    `{ pin, recommendationRefreshed: true }`.
 * `isCurrent` prevents restoring a selection the dispatcher cleared mid-refresh.
 */
export async function recheckSelectedRecommendation({
  query,
  selectionKey,
  invalidateSelectionCheck = () => {},
  isCurrent = () => true,
  resolveCurrentOption,
  chooseOption,
}) {
  invalidateSelectionCheck();
  const refreshed = await query.refetch();
  if (!isCurrent() || refreshed?.isError || !isCompletedRecommendation(refreshed?.data)) return refreshed;

  const current = resolveCurrentOption?.(refreshed.data, selectionKey);
  if (!isCurrent() || !current?.option || current.option.unavailable) return refreshed;
  return chooseOption(current.option, "Recheck selected option", {
    pin: current.pinnedKeys,
    recommendationRefreshed: true,
  });
}

/**
 * Return saved pairs for inert history after a failed refresh. Do not run current
 * eligibility rules over cached evidence; the caller renders these as historical.
 */
export function historicRecommendationPairs({ queryError, completedRecommendation, recommendation }) {
  if (!queryError || !completedRecommendation) return [];

  const result = recommendation?.pair;
  const recommended = result?.recommended && typeof result.recommended === "object" && !Array.isArray(result.recommended)
    ? result.recommended
    : null;
  const candidates = Array.isArray(result?.candidates)
    ? result.candidates.filter(candidate => candidate && typeof candidate === "object" && !Array.isArray(candidate))
    : [];
  const recommendedKey = recommended ? optionKey(recommended) : null;

  return [
    ...(recommended ? [recommended] : []),
    ...candidates.filter(candidate => optionKey(candidate) !== recommendedKey),
  ].slice(0, 2);
}
