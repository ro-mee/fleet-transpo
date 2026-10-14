import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { launchExternalNavigation } from './external-navigation';

const NAVIGATION_URL = 'https://www.google.com/maps/dir/?api=1&destination=14.6%2C121&travelmode=driving&dir_action=navigate';

describe('external navigation launcher', () => {
  it('reports an invalid target without calling the platform', async () => {
    const openUrl = vi.fn();
    await expect(launchExternalNavigation(null, openUrl)).resolves.toEqual({ ok: false, reason: 'invalid-target' });
    expect(openUrl).not.toHaveBeenCalled();
  });
  it('opens the encoded driving navigation URL once', async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    await expect(launchExternalNavigation({ lat: 14.6, lng: 121 }, openUrl)).resolves.toEqual({ ok: true });
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(NAVIGATION_URL);
  });
  it('waits for the platform to open the URL before reporting success', async () => {
    let finish;
    const openUrl = () => new Promise(resolve => { finish = resolve; });
    const settled = vi.fn();
    const launch = launchExternalNavigation({ lat: 14.6, lng: 121 }, openUrl).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    finish();
    await launch;
    expect(settled).toHaveBeenCalledWith({ ok: true });
  });
  it.each(['rejection', 'throw'])('reports a platform launch failure after a %s', async failure => {
    const openUrl = failure === 'rejection'
      ? vi.fn().mockRejectedValue(new Error('no handler'))
      : () => { throw new Error('no handler'); };
    await expect(launchExternalNavigation({ lat: 14.6, lng: 121 }, openUrl)).resolves.toEqual({ ok: false, reason: 'open-failed' });
  });
});

describe('explicit-destination navigation consumers', () => {
  const consumers = [
    ['Vehicle', 'mobile/app/(app)/(tabs)/vehicle.js', 'handleOpenGoogleMaps', '\n  const advanceTrip', {}, [14.6, 121]],
    ['TripMap', 'mobile/components/map.js', 'handleOpenGoogleMaps', '\n  const zoomStep', { destValid: true, destination: { latitude: 14.6, longitude: 121 } }, []],
    ['Incident', 'mobile/app/(app)/incident/navigate.js', 'openGoogleMaps', '\n  const driverName', { bakedDest: { lat: 14.6, lng: 121 } }, []],
  ];
  function handler(path, name, endMarker, context, openURL) {
    const source = readFileSync(path, 'utf8');
    const start = source.indexOf(`  const ${name} = `);
    const end = source.indexOf(endMarker, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return runInNewContext(`${source.slice(start, end)}\n${name};`, {
      ...context, Linking: { openURL }, launchExternalNavigation,
    });
  }
  it.each(consumers)('%s opens its explicit destination with driving navigation', async (_name, path, name, endMarker, context, args) => {
    const openURL = vi.fn().mockResolvedValue(undefined);
    await handler(path, name, endMarker, context, openURL)(...args);
    expect(openURL).toHaveBeenCalledExactlyOnceWith(NAVIGATION_URL);
  });
  it.each(consumers)('%s keeps launch failure quiet', async (_name, path, name, endMarker, context, args) => {
    const openURL = vi.fn().mockRejectedValue(new Error('no handler'));
    await expect(Promise.resolve(handler(path, name, endMarker, context, openURL)(...args))).resolves.toBeUndefined();
  });
});
