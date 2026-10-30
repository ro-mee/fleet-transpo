import { expect, it } from 'vitest';
import { mapSheetGeometry } from './map-layout';

it.each([0, 16, 48])('keeps restore, controls and sheet above the original nav with inset %s', bottomInset => {
  const bottomOffset = bottomInset >= 40 ? bottomInset + 4 : Math.max(Math.round(bottomInset * .55), 10);
  const clearance = bottomOffset + 64 + 16;
  const layout = mapSheetGeometry({ height: 800, top: 24, bottom: clearance, content: 166, expanded: false, minimized: false });
  expect(layout.sheetTop + layout.sheetHeight).toBe(800 - clearance);
  expect(layout.controlBottom).toBe(clearance + 166 + 10);
  const minimized = mapSheetGeometry({ height: 800, top: 24, bottom: clearance, content: 166, expanded: false, minimized: true });
  expect(minimized.restoreBottom).toBe(clearance);
  expect(minimized.controlBottom).toBeGreaterThan(minimized.restoreBottom + 48);
});
it('bounds enlarged content on a small screen and preserves scroll space', () => {
  const g = mapSheetGeometry({ height: 500, top: 30, bottom: 132, content: 900, expanded: false, minimized: false });
  expect(g.sheetHeight).toBeLessThanOrEqual(500 - 132 - 30 - 64);
  expect(g.sheetHeight).toBeGreaterThan(0);
  expect(g.sheetTop).toBeGreaterThanOrEqual(30 + 64);
});

it.each([false, true])('reserves measured directions above controls for an enlarged or expanded sheet (%s)', expanded => {
  const bannerBottom = 34 + 112;
  const layout = mapSheetGeometry({ height: 667, top: 24, navigationHeight: 112, bottom: 90, content: 900, expanded, minimized: false });
  const controlTop = 667 - layout.controlBottom - 48;
  expect(controlTop).toBeGreaterThanOrEqual(bannerBottom + 12);
  expect(layout.sheetTop).toBeGreaterThanOrEqual(controlTop + 48 + 10);
});
