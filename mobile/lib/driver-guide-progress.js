import { LEGACY_GUIDE_IMPORTS } from './driver-guides';

const variants = new Set(['common', 'passenger', 'cargo']);
export function guideProgressKey({ actorId, guideId, variant, version } = {}) {
  const actor = String(actorId ?? '').trim();
  if (!actor || !/^[a-zA-Z0-9_-]+$/.test(actor) || !/^[a-z][a-z0-9_.]*$/.test(guideId || '') || !variants.has(variant) || !Number.isInteger(version) || version < 1) throw new Error('Invalid guide progress scope');
  return `fleetops.guide2.${guideId}.${variant}.v${version}_${actor}`;
}

export function isGuideSuppressed(record) {
  return record?.status === 'dismissed' || record?.status === 'completed';
}

export function nextGuideProgress(previous, action, at) {
  if (action === 'interrupt') return previous;
  if (!['seen', 'dismiss', 'complete'].includes(action) || !Number.isFinite(at) || at < 0) throw new Error('Invalid guide progress event');
  if (action === 'seen' && isGuideSuppressed(previous)) return previous;
  return { status: action === 'dismiss' ? 'dismissed' : action === 'complete' ? 'completed' : 'seen', updatedAt: at, source: 'guide' };
}

export function importLegacyGuideProgress(scope, legacyValues, at) {
  guideProgressKey(scope);
  if (!Number.isFinite(at) || at < 0) throw new Error('Invalid migration time');
  const keys = LEGACY_GUIDE_IMPORTS[scope.guideId] || [];
  return keys.some(key => ['completed', 'true', true].includes(legacyValues?.[key]))
    ? { status: 'dismissed', source: 'legacy_unknown_outcome', updatedAt: at }
    : null;
}
