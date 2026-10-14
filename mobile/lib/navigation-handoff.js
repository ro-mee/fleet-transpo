import { navigationTarget } from './navigation-route';
import { legForStatus } from './trip-navigation-phase';
import { launchExternalNavigation } from './external-navigation';

/** Native tracking and current-trip checks are injected by the Map screen. */
export async function beginNavigationHandoff({ trip, prepare, rollback, openUrl, requestPermission = true, isCurrent = () => true }) {
  const target = navigationTarget(trip);
  const leg = legForStatus(trip?.trip_status);
  if (!target || !leg || trip?.trip_id == null || trip.trip_id === '') return { ok: false, reason: 'invalid-target' };
  if (!isCurrent()) return { ok: false, reason: 'stale-trip' };
  const ready = await prepare({ tripId: trip.trip_id, leg, requestPermission });
  if (!isCurrent()) {
    if (ready.ok) await rollback?.();
    return { ok: false, reason: 'stale-trip' };
  }
  if (!ready.ok) return { ...ready, target };
  const result = await launchExternalNavigation(target, openUrl);
  if (!result.ok) await rollback?.();
  return { ...result, target };
}
