import { externalNavigationUrl } from './navigation-route';

export async function launchExternalNavigation(target, openUrl) {
  const url = externalNavigationUrl(target);
  if (!url) return { ok: false, reason: 'invalid-target' };
  try {
    await openUrl(url);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'open-failed' };
  }
}
