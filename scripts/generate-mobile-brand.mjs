/** Rebuild FleetOps vectors, native bitmaps and the local 1.9 second route reveal. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'mobile/assets/brand');
const nativeOutput = path.dirname(output);
await mkdir(output, { recursive: true });
const wordmark = JSON.parse(await readFile(path.join(output, 'wordmark-outline.json'), 'utf8'));

const palettes = {
  light: { ribbon: '#285448', connection: '#8A632C', ground: '#F5F2EC', route: '#758E7D' },
  dark: { ribbon: '#F5F2EC', connection: '#D2A765', ground: '#0D1713', route: '#B1C2B6' },
  'high-contrast-light': { ribbon: '#000000', connection: '#000000', ground: '#FFFFFF', route: '#000000' },
  'high-contrast-dark': { ribbon: '#FFFFFF', connection: '#FFFFFF', ground: '#000000', route: '#FFFFFF' },
};

// Three open road bands with directional cut ends. Coordinates are shared by SVG and Lottie.
// Each point is [x, y, incoming-control-x, incoming-control-y, outgoing-control-x, outgoing-control-y].
const ribbons = [
  [[78, 240, 78, 240, 78, 174], [120, 94, 80, 120, 148, 76], [238, 78, 190, 75, 238, 78],
    [225, 101, 225, 101, 181, 98], [132, 116, 151, 102, 103, 138], [106, 225, 105, 183, 106, 225]],
  [[115, 240, 115, 240, 111, 201], [138, 151, 116, 169, 157, 135], [216, 133, 184, 131, 216, 133],
    [203, 157, 203, 157, 180, 156], [150, 174, 160, 161, 137, 189], [140, 226, 138, 210, 140, 226]],
  [[150, 240, 150, 240, 144, 216], [162, 183, 147, 194, 175, 174], [208, 174, 192, 172, 208, 174],
    [195, 197, 195, 197, 185, 196], [176, 204, 178, 199, 171, 212], [176, 226, 175, 221, 176, 226]],
];
const connection = { x: 220, y: 183, radius: 10 };
const routes = [
  [[27, 280, 27, 280, 67, 266], [92, 229, 91, 259, 88, 171], [126, 105, 89, 130, 152, 88], [231, 89, 193, 85, 231, 89]],
  [[294, 88, 294, 88, 267, 137], [210, 145, 245, 144, 175, 144], [146, 162, 165, 150, 125, 180], [128, 233, 125, 208, 128, 233]],
  [[285, 268, 285, 268, 244, 248], [165, 230, 180, 252, 158, 215], [168, 192, 155, 203, 179, 182], [202, 186, 191, 183, 202, 186]],
];

function svgPath(points, closed = true) {
  let value = `M${points[0][0]} ${points[0][1]}`;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const point = points[index];
    value += `C${before[4]} ${before[5]} ${point[2]} ${point[3]} ${point[0]} ${point[1]}`;
  }
  return value + (closed ? 'Z' : '');
}

function lottiePath(points, closed = true) {
  return {
    v: points.map(([x, y]) => [x, y]),
    i: points.map(([x, y, ix, iy]) => [ix - x, iy - y]),
    o: points.map(([x, y, , , ox, oy]) => [ox - x, oy - y]),
    c: closed,
  };
}

const markPaths = palettesFor => ribbons.map(points => `<path d="${svgPath(points)}" fill="${palettesFor.ribbon}"/>`).join('')
  + `<circle cx="${connection.x}" cy="${connection.y}" r="${connection.radius}" fill="${palettesFor.connection}"/>`;
const svg = (body, viewBox = '68 68 184 184', width = 640, height = width) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="FleetOps">${body}</svg>\n`;

function outlinedWordmark(palette, x = 260, y = 191, scale = 0.76) {
  let advance = 0;
  const glyphs = wordmark.glyphs.map((glyph, index) => {
    const rendered = `<path transform="translate(${advance} 0)" fill="${index < 5 ? palette.ribbon : palette.connection}" d="${glyph.path}"/>`;
    advance += glyph.advance - 0.7;
    return rendered;
  }).join('');
  return `<g transform="translate(${x} ${y}) scale(${scale})">${glyphs}</g>`;
}

const constant = value => ({ a: 0, k: value });
const color = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255).concat(1);
function animated(values) {
  return { a: 1, k: values.map(([t, s], index) => index === values.length - 1
    ? { t, s: [s] }
    : { t, s: [s], e: [values[index + 1][1]], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } }) };
}
const transform = opacity => ({ o: opacity, r: constant(0), p: constant([0, 0, 0]), a: constant([0, 0, 0]), s: constant([100, 100, 100]) });
const shape = (points, closed) => ({ ty: 'sh', nm: 'Shared route geometry', ks: constant(lottiePath(points, closed)) });
const fill = hex => ({ ty: 'fl', nm: 'Brand fill', c: constant(color(hex)), o: constant(100), r: 1 });
const shapeLayer = (name, index, shapes, opacity = constant(100)) => ({
  ddd: 0, ind: index, ty: 4, nm: name, sr: 1, ks: transform(opacity), ao: 0,
  shapes, ip: 0, op: 114, st: 0, bm: 0,
});

function reveal(palette) {
  const layers = [];
  routes.forEach((points, index) => {
    // A path is drawn inward, then its outer section recedes as the filled band forms.
    layers.push(shapeLayer(`Route ${index + 1}`, index + 1, [
      shape(points, false),
      { ty: 'st', nm: 'Route stroke', c: constant(color(index === 2 ? palette.connection : palette.route)), o: constant(100), w: constant(2.6), lc: 2, lj: 2, ml: 4 },
      { ty: 'tm', nm: 'Inward route reveal', s: animated([[0, 0], [38, 0], [60, 100]]), e: animated([[index * 6, 0], [42, 100], [114, 100]]), o: constant(0), m: 1 },
    ], animated([[0, 0], [3 + index * 6, 100], [45, 100], [63, 0], [114, 0]])));
  });
  ribbons.forEach((points, index) => layers.push(shapeLayer(`Ribbon ${index + 1}`, index + 4,
    [shape(points, true), fill(palette.ribbon)], animated([[0, 0], [42 + index * 2, 0], [59 + index * 2, 100], [114, 100]]))));
  layers.push(shapeLayer('Connection', 7, [
    { ty: 'el', nm: 'Connection point', p: constant([connection.x, connection.y]), s: constant([connection.radius * 2, connection.radius * 2]), d: 1 }, fill(palette.connection),
  ], animated([[0, 0], [49, 0], [63, 100], [114, 100]])));
  return { v: '5.12.2', fr: 60, ip: 0, op: 114, w: 320, h: 320, nm: 'FleetOps route reveal', ddd: 0, assets: [], layers, markers: [
    { tm: 0, cm: 'Route opening', dr: 42 }, { tm: 42, cm: 'Mark formation', dr: 21 }, { tm: 63, cm: 'Final mark hold', dr: 51 },
  ] };
}

async function saveText(name, contents) {
  await writeFile(path.join(output, name), contents, 'utf8');
}
async function bitmap(name, body, { viewBox = '68 68 184 184', size = 640, height = size, native = false, opaque = false } = {}) {
  let renderer = sharp(Buffer.from(svg(body, viewBox, size, height), 'utf8'));
  if (opaque) renderer = renderer.removeAlpha();
  const result = await renderer.png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(native ? nativeOutput : output, name), result);
  const info = await sharp(result).metadata();
  assert.equal(info.width, size, `${name} width`);
  assert.equal(info.height, height, `${name} height`);
  return result;
}

for (const [variant, palette] of Object.entries(palettes)) {
  const body = markPaths(palette);
  const animation = reveal(palette);
  assert.equal(animation.fr, 60);
  assert.equal(animation.op, 114);
  assert.equal(animation.assets.length, 0);
  assert.equal(animation.layers.filter(layer => layer.nm.startsWith('Ribbon ')).length, 3);
  animation.layers.filter(layer => layer.nm.startsWith('Ribbon ')).forEach((layer, index) => {
    assert.deepEqual(layer.shapes[0].ks.k, lottiePath(ribbons[index]));
    assert.equal(layer.ks.o.k.at(-1).s[0], 100);
  });
  assert.equal(animation.layers.find(layer => layer.nm === 'Connection').ks.o.k.at(-1).s[0], 100);
  await saveText(`mark-${variant}.svg`, svg(body));
  await bitmap(`mark-${variant}.png`, body);
  await saveText(`lockup-${variant}.svg`, svg(body + outlinedWordmark(palette), '62 65 570 190', 1140, 380));
  await saveText(`route-reveal-${variant}.json`, JSON.stringify(animation) + '\n');
}

// Native icons: the mark is 54% of the square, inside Android's central safe zone.
const nativeBody = `<g transform="translate(-2 -2)">${markPaths(palettes.light)}</g>`;
const iconViewBox = '8 8 300 300';
for (const name of ['fleetops-icon.png', 'icon.png']) {
  await bitmap(name, `<rect x="8" y="8" width="300" height="300" fill="${palettes.light.ground}"/>${nativeBody}`, { viewBox: iconViewBox, size: 1024, native: true, opaque: true });
}
await bitmap('android-icon-foreground.png', nativeBody, { viewBox: iconViewBox, size: 1024, native: true });
const monochrome = markPaths({ ribbon: '#FFFFFF', connection: '#FFFFFF' });
const monoBuffer = await bitmap('android-icon-monochrome.png', `<g transform="translate(-2 -2)">${monochrome}</g>`, { viewBox: iconViewBox, size: 1024, native: true });
const { data: monoPixels, info: monoInfo } = await sharp(monoBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let minX = 1024; let maxX = 0; let minY = 1024; let maxY = 0;
for (let index = 0; index < monoPixels.length; index += 4) {
  if (monoPixels[index + 3] === 0) continue;
  assert.deepEqual([...monoPixels.subarray(index, index + 3)], [255, 255, 255], 'Monochrome RGB must be white; silhouette is alpha only');
  const pixel = index / 4;
  minX = Math.min(minX, pixel % monoInfo.width); maxX = Math.max(maxX, pixel % monoInfo.width);
  minY = Math.min(minY, Math.floor(pixel / monoInfo.width)); maxY = Math.max(maxY, Math.floor(pixel / monoInfo.width));
}
assert.ok(minX >= 210 && minY >= 210 && maxX <= 814 && maxY <= 814, 'Adaptive mark must remain in central safe zone');
await bitmap('android-icon-background.png', `<rect width="320" height="320" fill="${palettes.light.ground}"/>`, { viewBox: '0 0 320 320', size: 1024, native: true, opaque: true });
await bitmap('favicon.png', markPaths(palettes.light), { size: 64, native: true });
for (const variant of ['light', 'dark']) {
  await bitmap(`splash-mark-${variant}.png`, markPaths(palettes[variant]), { viewBox: '77 75 162 166', size: 648, height: 664 });
}

const board = Object.entries(palettes).map(([name, palette], index) => {
  const x = (index % 2) * 600; const y = Math.floor(index / 2) * 340;
  return `<g transform="translate(${x} ${y})"><rect width="600" height="340" fill="${palette.ground}"/><text x="44" y="42" font-family="sans-serif" font-size="12" letter-spacing="2" fill="${palette.connection}">${name.toUpperCase()}</text><g transform="translate(44 78) scale(.78)">${markPaths(palette)}${outlinedWordmark(palette, 260, 190, .72)}</g><text x="44" y="298" font-family="sans-serif" font-size="12" fill="${palette.ribbon}">Route ribbons · Forest / Ivory / Brass</text><g transform="translate(520 265) scale(.22) translate(-160 -160)">${markPaths(palette)}</g></g>`;
}).join('');
await saveText('preview.svg', svg(board, '0 0 1200 680', 1200, 680));
await bitmap('brand-board.png', board, { viewBox: '0 0 1200 680', size: 1200, height: 680 });
console.log('FleetOps assets generated. Four SVG/PNG marks, outlined lockups, four 1,900 ms local Lottie files, native icons and splash marks verified.');
console.log(`Adaptive alpha bounds: x=${minX}..${maxX}, y=${minY}..${maxY} in 1024 square.`);
