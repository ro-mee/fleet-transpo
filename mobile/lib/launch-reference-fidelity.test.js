import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { expect, it } from 'vitest';

const references = [
  ['light', { left: 1333, top: 130, width: 312, height: 648 }],
  ['dark', { left: 1338, top: 136, width: 312, height: 630 }],
];

it.each(references)('preserves every approved %s final-frame pixel and its aspect ratio', async (variant, crop) => {
  const original = await sharp(`docs/design/mobile-launch/05-letter-arrival-${variant}-v1-2026-10-28.png`).extract(crop).removeAlpha().raw().toBuffer();
  const { data, info } = await sharp(`mobile/assets/brand/launch-${variant}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([crop.width, crop.height]);
  expect(data.equals(original), 'Final artwork must be the reference pixels, without resampling or recoloring').toBe(true);
  const animation = JSON.parse(await readFile(`mobile/assets/brand/route-reveal-${variant}.json`, 'utf8'));
  expect([animation.w, animation.h]).toEqual([crop.width, crop.height]);
  const final = animation.layers[0];
  expect(final.ty).toBe(2);
  expect(final.ip).toBeLessThanOrEqual(105);
  expect(final.op).toBe(114);
  expect(final.ks.o).toEqual({ a: 0, k: 100 });
  expect(final.ks.p).toEqual({ a: 0, k: [0, 0, 0] });
  expect(final.ks.s).toEqual({ a: 0, k: [100, 100, 100] });
  const image = animation.assets.find(asset => asset.id === final.refId);
  expect(image.p.startsWith('data:image/png;base64,')).toBe(true);
  const embedded = await sharp(Buffer.from(image.p.split(',')[1], 'base64')).removeAlpha().raw().toBuffer();
  expect(embedded.equals(original), 'The topmost final animation frame must use the same untouched source pixels').toBe(true);
});
