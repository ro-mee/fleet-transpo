import { getDriverGuide, LEGACY_GUIDE_IMPORTS } from './driver-guides';
import { evaluateGuideEligibility } from './driver-guide-policy';
import { importLegacyGuideProgress, isGuideSuppressed, nextGuideProgress } from './driver-guide-progress';
import { isRouteMatch } from './coach-marks';

// This controller owns guidance only; screens retain all operational handlers.
export function createDriverGuideController({ getContext, storage, onChange, now = Date.now }) {
  let active = null, error = null, presentationId = 0, revision = 0, serial = 0;
  let pending = null, previousScope = null;
  const visits = new Set(), registrations = new Map();
  const winner = (id, route) => {
    const entries = registrations.get(id);
    return entries ? [...entries.values()].filter(e => e.route === route).sort((a, b) => b.serial - a.serial)[0] : null;
  };
  const getState = () => {
    const candidate = active?.step?.targetId ? winner(active.step.targetId, active.route) : null;
    return { active, error, presentationId, target: candidate?.box?.presentationId === presentationId ? candidate.box : null };
  };
  const emit = () => onChange(getState());
  const hasTarget = (id, route) => Boolean(winner(id, route));
  const interrupt = () => { revision++; pending = null; active = null; presentationId++; emit(); };
  const policy = (guide, source, route) => {
    const context = getContext();
    return evaluateGuideEligibility({ ...context, now: now(), kind: source === 'manual' ? 'details' : 'automatic', routeReady: context.route === route, targetReady: !guide.steps[0].targetId || hasTarget(guide.steps[0].targetId, route) });
  };
  const scopeFor = (guide, actorId, valid) => ({ actorId, guideId: guide.id, variant: guide.variant, version: guide.version, isCurrent: valid });

  function reconcile() {
    const context = getContext();
    const scope = `${context.actorId}|${context.sessionGeneration ?? ''}|${context.route}`;
    if (previousScope !== null && previousScope !== scope) { visits.clear(); interrupt(); }
    previousScope = scope;
    if (active && !policy(active.guide, active.source, active.route).allowed) interrupt();
  }

  async function requestGuide({ guideId, variant, source = 'automatic', context: stepContext = null } = {}) {
    reconcile();
    const context = getContext(), route = context.route;
    const guide = getDriverGuide(guideId, variant);
    if (!guide || active || pending || !['automatic', 'manual'].includes(source)) return false;
    if (source === 'automatic' && !isRouteMatch(route, guide.route)) return false;
    if (source === 'automatic' && visits.has(route)) return false;
    if (!policy(guide, source, route).allowed) return false;
    const epoch = revision, actorId = context.actorId;
    const token = Symbol('guide-request'); pending = token;
    const valid = () => pending === token && revision === epoch && getContext().actorId === actorId && getContext().route === route && policy(guide, source, route).allowed;
    const scope = scopeFor(guide, actorId, () => getContext().actorId === actorId && revision === epoch);
    try {
      let saved = await storage.read(scope);
      if (!valid() || !saved.available) return false;
      if (!saved.record) {
        const values = await storage.legacy(LEGACY_GUIDE_IMPORTS[guide.id] || [], actorId);
        if (!valid()) return false;
        const imported = importLegacyGuideProgress(scope, values, now());
        if (imported) {
          if (!await storage.write(scope, imported) || !valid()) return false;
          saved = { available: true, record: imported };
        }
      }
      if (source === 'automatic' && isGuideSuppressed(saved.record)) return false;
      if (!valid()) return false;
      const step = source === 'manual' ? { ...guide.steps[0], targetId: null } : guide.steps[0];
      active = { sessionId: `guide-${++serial}`, epoch, guide, step, stepIndex: 0, source, route, actorId, context: stepContext };
      presentationId++; error = null;
      if (source === 'automatic') visits.add(route);
      emit();
      if (!isGuideSuppressed(saved.record)) await storage.write(scope, nextGuideProgress(saved.record, 'seen', now()));
      return revision === epoch && active?.guide === guide;
    } finally { if (pending === token) pending = null; }
  }

  async function finish(action) {
    if (!active) return false;
    const owner = active, epoch = revision;
    active = null; presentationId++; emit();
    const valid = () => getContext().actorId === owner.actorId && revision === epoch;
    const saved = await storage.write(scopeFor(owner.guide, owner.actorId, valid), nextGuideProgress(null, action, now()));
    if (valid() && !saved) { error = 'Could not save guide progress. You can reopen this guide from Help & Support.'; emit(); }
    return saved;
  }

  function registerTarget(id, box, route, token = id) {
    if (!id || !box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return;
    const entries = registrations.get(id) || new Map();
    const old = entries.get(token);
    if (old && old.route === route && ['x', 'y', 'width', 'height', 'presentationId'].every(k => old.box[k] === box[k])) return;
    entries.set(token, { box, route, serial: ++serial }); registrations.set(id, entries);
    if (active?.step.targetId === id) emit();
  }

  function unregisterTarget(id, token = id) {
    const entries = registrations.get(id);
    if (!entries?.delete(token)) return;
    if (!entries.size) registrations.delete(id);
    if (active?.step.targetId === id) emit();
  }

  return {
    getState, requestGuide, replayGuide: args => requestGuide({ ...args, source: 'manual' }),
    hasTarget, registerTarget, unregisterTarget, reconcile, interrupt,
    dismiss: () => finish('dismiss'), complete: () => finish('complete'),
    recordGuideEvent(event) {
      if (!active || event?.sessionId !== active.sessionId || event.epoch !== active.epoch || event.stepId !== active.step.id || event.type !== active.step.eventType || event.outcome?.success !== true) return false;
      void finish('complete'); return true;
    },
    async resetTips() {
      const actor = getContext().actorId;
      interrupt(); visits.clear();
      const ok = await storage.reset(actor);
      if (!ok && getContext().actorId === actor) { error = 'Could not reset tips. Please try again.'; emit(); }
      return ok;
    },
  };
}
