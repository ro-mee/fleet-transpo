import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// These are measured interiors of the approved boards, not redrawn artwork.
const references = {
  light: { crop: [1333, 130, 312, 648], mark: [28, 148, 268, 268], word: [28, 425, 264, 70], cuts: [28, 65, 79, 114, 148, 172, 222, 260, 292], background: '#F9F6EF' },
  dark: { crop: [1338, 136, 312, 630], mark: [24, 160, 274, 246], word: [28, 415, 264, 65], cuts: [28, 65, 80, 115, 149, 174, 223, 260, 292], background: '#001B15' },
};
const value = k => ({ a: 0, k });
const animated = keys => ({ a: 1, k: keys.map(([t, s], index) => ({ t, s: Array.isArray(s) ? s : [s], ...(index < keys.length - 1 ? { o: { x: [0.18], y: [0.05] }, i: { x: [0.3], y: [1] } } : {}) })) });
const rectangle = (x, y, w, h) => ({ c: true, v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]] });
const mask = box => ({ inv: false, mode: 'a', pt: value(rectangle(...box)), o: value(100), x: value(0) });
const transform = (opacity = value(100), position = value([0, 0, 0])) => ({ o: opacity, r: value(0), p: position, a: value([0, 0, 0]), s: value([100, 100, 100]) });
function imageLayer(name, refId, { opacity, position, box, start = 0, end = 114 } = {}) {
  return { ty: 2, nm: name, refId, ddd: 0, sr: 1, ks: transform(opacity, position), ip: start, op: end, st: 0, bm: 0,
    ...(box ? { hasMask: true, masksProperties: [mask(box)] } : {}) };
}
const svgImage = (png, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`;

// UI cutouts retain the reference RGB. Only the external background alpha is removed.
// The complete launch plate never passes through this matte operation.
async function cutout(plate, box, dark, keepHoles = false) {
  const [left, top, width, height] = box;
  const { data } = await sharp(plate).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const li = y * width * 3, ri = (y * width + width - 1) * 3;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      let difference = 0;
      for (let c = 0; c < 3; c++) {
        const bg = data[li + c] + (data[ri + c] - data[li + c]) * x / (width - 1);
        difference = Math.max(difference, Math.abs(data[i + c] - bg));
      }
      const low = dark ? 9 : 19, high = dark ? 24 : 45;
      const strength = keepHoles
        ? (dark ? (Math.max(...data.subarray(i, i + 3)) - 150) / 65 : (180 - Math.min(...data.subarray(i, i + 3))) / 50)
        : (difference - low) / (high - low);
      const edge = Math.min(1, Math.min(x, y, width - 1 - x, height - 1 - y) / (keepHoles ? 3 : 7));
      alpha[y * width + x] = Math.round(255 * Math.max(0, Math.min(1, strength)) * edge);
    }
  }
  if (!keepHoles) {
    // Preserve both luminous hotel windows, while the arch stays open to outside.
    const outside = new Uint8Array(width * height), queue = [];
    const add = i => { if (i >= 0 && i < outside.length && !outside[i] && alpha[i] < 128) { outside[i] = 1; queue.push(i); } };
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
    for (let n = 0; n < queue.length; n++) {
      const i = queue[n], x = i % width;
      if (x) add(i - 1); if (x < width - 1) add(i + 1); add(i - width); add(i + width);
    }
    for (let i = 0; i < alpha.length; i++) if (!outside[i]) alpha[i] = 255;
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).joinChannel(Buffer.from(alpha), { raw: { width, height, channels: 1 } }).png().toBuffer();
}

export async function generateReferenceBrand(root, output) {
  const metadata = { source: 'Approved five-state reference boards, final-panel interiors; all rectangles are [left, top, width, height].', variants: {} };
  const previews = [];
  for (const [variant, spec] of Object.entries(references)) {
    const dark = variant === 'dark';
    const [left, top, width, height] = spec.crop;
    const source = path.join(root, `docs/design/mobile-launch/05-letter-arrival-${variant}-v1-2026-10-28.png`);
    const plate = await sharp(await readFile(source)).extract({ left, top, width, height }).png({ compressionLevel: 9 }).toBuffer();
    const rgb = await sharp(plate).removeAlpha().raw().toBuffer();
    const sourceRgb = await sharp(source).extract({ left, top, width, height }).removeAlpha().raw().toBuffer();
    assert.ok(rgb.equals(sourceRgb), 'Reference plate must preserve every original RGB sample');
    await writeFile(path.join(output, `launch-${variant}.png`), plate);
    await writeFile(path.join(output, `launch-${variant}.svg`), svgImage(plate, width, height), 'utf8');

    // A locally interpolated background is visible only while the original artwork forms.
    // The untouched full plate replaces it smoothly before the final hold.
    const backdrop = Buffer.from(rgb);
    for (let y = 0; y < height; y++) {
      const li = (y * width + 3) * 3, ri = (y * width + width - 4) * 3;
      for (let x = 4; x < width - 4; x++) for (let c = 0; c < 3; c++) {
        backdrop[(y * width + x) * 3 + c] = Math.round(rgb[li + c] + (rgb[ri + c] - rgb[li + c]) * (x - 3) / (width - 7));
      }
    }
    const background = await sharp(backdrop, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
    const mark = await cutout(plate, spec.mark, dark);
    const wordmark = await cutout(plate, spec.word, dark, true);
    // Move transparent artwork, not rectangular pieces of its photographed floor.
    const foreground = await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).composite([
      { input: mark, left: spec.mark[0], top: spec.mark[1] },
      { input: wordmark, left: spec.word[0], top: spec.word[1] },
    ]).png().toBuffer();
    const assets = [
      { id: 'reference-final', w: width, h: height, u: '', p: 'data:image/png;base64,' + plate.toString('base64'), e: 1 },
      { id: 'formation-background', w: width, h: height, u: '', p: 'data:image/png;base64,' + background.toString('base64'), e: 1 },
      { id: 'formation-foreground', w: width, h: height, u: '', p: 'data:image/png;base64,' + foreground.toString('base64'), e: 1 },
    ];
    const layers = [
      imageLayer('Untouched approved final frame', 'reference-final', { start: 90 }),
      imageLayer('Seamless reference finish', 'reference-final', { start: 78, end: 90, opacity: animated([[78, 0], [90, 100]]) }),
    ];
    const [, wordTop, , wordHeight] = spec.word;
    for (let i = 7; i >= 0; i--) {
      const start = 36 + i * 4.5;
      layers.push(imageLayer(`Letter ${i + 1} ${'FleetOps'[i]} reference texture`, 'formation-foreground', {
        box: [spec.cuts[i], wordTop, spec.cuts[i + 1] - spec.cuts[i], wordHeight],
        opacity: animated([[0, 0], [start, 0], [start + 6, 100]]),
        position: animated([[0, [0, -18, 0]], [start, [0, -18, 0]], [start + 10.8, [0, 0, 0]]]),
      }));
    }
    layers.push(imageLayer('Original floor reflection', 'reference-final', { box: [0, wordTop + wordHeight, width, height - wordTop - wordHeight], opacity: animated([[0, 0], [61, 0], [84, 100]]) }));
    // Retire adjacent reveal masks once assembled to avoid an antialiased join line.
    layers.push(imageLayer('Assembled original hotel and road', 'formation-foreground', { box: [0, 130, width, wordTop - 130], start: 30 }));
    layers.push(imageLayer('Original hotel facade and illuminated windows', 'formation-foreground', { box: [0, 130, width, 211], end: 30, opacity: animated([[0, 0], [6, 0], [30, 100]]) }));
    const road = imageLayer('Original glowing curved road', 'formation-foreground', { box: [0, 340, width, wordTop - 340], end: 30, opacity: animated([[0, 0], [2, 0], [22, 100]]) });
    road.masksProperties[0].pt = { a: 1, k: [
      { t: 0, s: [rectangle(0, 340, 1, wordTop - 340)], o: { x: [0.18], y: [0.05] }, i: { x: [0.3], y: [1] } },
      { t: 24, s: [rectangle(0, 340, width, wordTop - 340)] },
    ] };
    layers.push(road, imageLayer('Formation backdrop', 'formation-background'));
    const animation = { v: '5.12.2', fr: 60, ip: 0, op: 114, w: width, h: height, nm: `FleetOps exact ${variant} reference arrival`, ddd: 0, assets, layers: layers.map((layer, index) => ({ ...layer, ind: index + 1 })) };
    await writeFile(path.join(output, `route-reveal-${variant}.json`), JSON.stringify(animation) + '\n', 'utf8');

    await writeFile(path.join(output, `mark-${variant}.png`), mark);
    await writeFile(path.join(output, `mark-${variant}.svg`), svgImage(mark, spec.mark[2], spec.mark[3]), 'utf8');
    await writeFile(path.join(output, `wordmark-${variant}.png`), wordmark);
    await writeFile(path.join(output, `splash-mark-${variant}.png`), await sharp(mark).resize(640, 640, { fit: 'contain', background: '#00000000' }).png().toBuffer());
    const lockup = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="140"><image x="0" y="0" width="140" height="140" href="data:image/png;base64,${mark.toString('base64')}"/><image x="164" y="35" width="352" height="${352 * spec.word[3] / spec.word[2]}" href="data:image/png;base64,${wordmark.toString('base64')}"/></svg>\n`;
    await writeFile(path.join(output, `lockup-${variant}.svg`), lockup, 'utf8');
    metadata.variants[variant] = { source: path.relative(root, source).replaceAll('\\', '/'), crop: spec.crop, width, height, mark: spec.mark, wordmark: spec.word, background: spec.background };
    previews.push(await sharp(plate).resize({ height: 648 }).png().toBuffer());
    if (!dark) {
      const iconMark = await sharp(mark).resize(540, 540, { fit: 'contain', background: '#00000000' }).png().toBuffer();
      const foreground = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } }).composite([{ input: iconMark, left: 242, top: 242 }]).png().toBuffer();
      const icon = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#F5F2EC' } }).composite([{ input: foreground }]).png().toBuffer();
      const native = path.dirname(output);
      for (const filename of ['fleetops-icon.png', 'icon.png']) await writeFile(path.join(native, filename), icon);
      await writeFile(path.join(native, 'android-icon-foreground.png'), foreground);
      await writeFile(path.join(native, 'favicon.png'), await sharp(mark).resize(64, 64, { fit: 'contain', background: '#00000000' }).png().toBuffer());
    }
  }
  await writeFile(path.join(output, 'reference-artwork.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  const right = await sharp(previews[1]).metadata();
  const board = await sharp({ create: { width: 312 + right.width, height: 648, channels: 3, background: '#F5F2EC' } }).composite([{ input: previews[0], left: 0, top: 0 }, { input: previews[1], left: 312, top: 0 }]).png().toBuffer();
  await writeFile(path.join(output, 'reference-comparison.png'), board);
  const hcLight = await sharp(path.join(output, 'launch-high-contrast-light.png')).resize(312, 555).png().toBuffer();
  const hcDark = await sharp(path.join(output, 'launch-high-contrast-dark.png')).resize(right.width, 555).png().toBuffer();
  const fourModes = await sharp({ create: { width: 312 + right.width, height: 1203, channels: 3, background: '#FFFFFF' } }).composite([
    { input: board, left: 0, top: 0 }, { input: hcLight, left: 0, top: 648 }, { input: hcDark, left: 312, top: 648 },
  ]).png().toBuffer();
  await writeFile(path.join(output, 'brand-board.png'), fourModes);
  await writeFile(path.join(output, 'preview.svg'), svgImage(fourModes, 312 + right.width, 1203), 'utf8');
  console.log('Normal launch frames now match the approved reference RGB exactly: light312x648, dark312x630.');
}
