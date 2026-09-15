import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

it('keeps coverage geographic when zooming, moving and recentering', () => {
  const source = readFileSync('mobile/components/TomTomMap.js', 'utf8');
  const style = {};
  let scale = 1000;
  let center = { lng: 121, lat: 14.6 };
  let fit;
  const window = {
    currentRadarKm: 5,
    originMarker: { getLngLat: () => center },
    ttMap: {
      project: p => ({ x: (p.lng ?? p[0]) * scale, y: (p.lat ?? p[1]) * scale }),
      getContainer: () => ({ clientHeight: 720 }),
      getZoom: () => 11,
      fitBounds: (bounds, options) => { fit = { bounds, options }; },
    },
  };
  const context = vm.createContext({
    window,
    document: { getElementById: () => ({ style }) },
    tt: { LngLatBounds: class { points = []; extend(p) { this.points.push(p); } } },
  });
  for (const name of ['createGeoJsonCircle', 'updateRadarCirclePositions', 'updateRadarBloomScale', 'recenterRadar']) {
    const body = source.match(new RegExp(`window\\.${name} = function[\\s\\S]*?^              };`, 'm'))[0];
    vm.runInContext(body, context);
  }
  window.updateRadarBloomScale();
  const diameter = parseFloat(style.width);
  expect(diameter).toBeCloseTo(10000 / (111.32 * Math.cos(14.6 * Math.PI / 180)), 5);
  scale /= 2;
  window.updateRadarBloomScale();
  expect(parseFloat(style.width)).toBeCloseTo(diameter / 2, 5);
  expect(style.height).toBe(style.width);
  center = { lng: 122, lat: 30 };
  window.updateRadarCirclePositions();
  expect(parseFloat(style.width)).toBeGreaterThan(diameter / 2);
  window.recenterRadar();
  expect(window.isFollowing).toBe(true);
  expect(window.currentRadarZoom).toBe(11);
  expect(fit.bounds.points).toHaveLength(65);
  expect(fit.options.padding.bottom).toBeGreaterThan(fit.options.padding.top);
  expect(fit.options.bearing).toBe(0);
});
