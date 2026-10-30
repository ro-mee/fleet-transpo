/** Rebuild Hotel Route vectors, native bitmaps and the self-contained 1.9-second launch. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { generateReferenceBrand } from './lib/mobile-brand-reference.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'mobile/assets/brand');
const nativeOutput = path.dirname(output);
await mkdir(output, { recursive: true });
const wordmark = JSON.parse(await readFile(path.join(output, 'wordmark-outline.json'), 'utf8'));
const palettes = {
  light: { ground: '#F5F2EC', ambient: '#FFFCF6', ink: '#073D30', edge: '#426A55', gold: '#B78237', dark: false },
  dark: { ground: '#0D1713', ambient: '#003027', ink: '#F7DFAB', edge: '#DADDB9', gold: '#E5AE58', dark: true },
  'high-contrast-light': { ground: '#FFFFFF', ink: '#000000', mono: true },
  'high-contrast-dark': { ground: '#000000', ink: '#FFFFFF', mono: true },
};
// Absolute geometry is shared by SVG, PNG and Lottie. Windows and doorway are real cutouts.
const HOTEL = 'M79 22 Q79 16 85 16 L151 16 Q155 16 155 20 L155 39 L245 39 Q249 39 249 43 L249 58 C249 71 239 80 226 80 L155 80 L155 106 L222 106 Q226 106 226 110 L226 124 C226 137 215 146 201 146 L155 146 L155 220 L131 230 L131 194 C131 185 125 178 116 178 C107 178 101 185 101 194 L101 241 L79 248 Z';
const WINDOWS = ['M104 48 L127 48 L127 74 L104 74 Z', 'M104 94 L127 94 L127 120 L104 120 Z'];
const FACE = HOTEL + WINDOWS.join('');
const CANOPY = 'M85 171 L116 150 L148 171 L148 176 L85 176 Z';
const CANOPY_FACE = 'M85 173 L116 157 L148 173 L148 176 L85 176 Z';
const ROAD = 'M33 265 C77 263 109 251 141 234 C178 214 205 202 235 204 C262 204 285 215 300 226 C266 219 242 228 209 246 C165 270 119 287 33 265 Z';
const ROAD_TIP = 'M252 206 C272 209 289 218 300 226 C286 223 275 223 267 224 C265 217 259 210 252 206 Z';
const DASHES = [
  'M153 248 C161 244 168 240 176 237 L182 241 C174 245 167 249 160 253 Z',
  'M195 227 C203 224 210 222 218 220 L223 224 C215 226 208 228 200 231 Z',
];
const DOOR_EDGE = 'M101 239 L101 194 C101 185 107 178 116 178 C125 178 131 185 131 194 L131 229';
const ROAD_EDGE = 'M33 265 C77 263 109 251 141 234 C178 214 205 202 235 204 C262 204 285 215 300 226';
const MARK_BOUNDS = [22, 8, 290, 286];
const MARK_PLACEMENT = { x: 13, y: 151, scale: 1 };
const LETTER_BASELINE = 490;
const LETTER_SCALE = 0.6;
const LETTER_TRACKING = -1.3;
const FRAME_COUNT = 114;
function parsePath(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g);
  const contours = [];
  let index = 0; let command; let cursor = [0, 0]; let contour;
  const point = () => [Number(tokens[index++]), Number(tokens[index++])];
  const add = (end, c1 = cursor, c2 = end) => {
    if (contour.v.length) contour.o[contour.v.length - 1] = [c1[0] - cursor[0], c1[1] - cursor[1]];
    contour.v.push(end); contour.i.push([c2[0] - end[0], c2[1] - end[1]]); contour.o.push([0, 0]); cursor = end;
  };
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    if (command === 'M') {
      cursor = point(); contour = { v: [cursor], i: [[0, 0]], o: [[0, 0]], c: false }; contours.push(contour); command = 'L';
    } else if (command === 'L') add(point());
    else if (command === 'H') add([Number(tokens[index++]), cursor[1]]);
    else if (command === 'V') add([cursor[0], Number(tokens[index++])]);
    else if (command === 'C') { const c1 = point(); const c2 = point(); add(point(), c1, c2); }
    else if (command === 'Q') {
      const q = point(); const end = point();
      add(end, [cursor[0] + (q[0] - cursor[0]) * 2 / 3, cursor[1] + (q[1] - cursor[1]) * 2 / 3], [end[0] + (q[0] - end[0]) * 2 / 3, end[1] + (q[1] - end[1]) * 2 / 3]);
    } else if (command?.toUpperCase() === 'Z') {
      contour.c = true;
      if (contour.v.length > 1 && contour.v.at(-1).every((n, i) => n === contour.v[0][i])) {
        contour.i[0] = contour.i.pop(); contour.v.pop(); contour.o.pop();
      }
      cursor = contour.v[0]; command = undefined;
    } else throw new Error('Unsupported path command ' + command);
  }
  return contours;
}
const round = value => Math.round(value * 10000) / 10000;
function mapPaths(paths, x = 0, y = 0, sx = 1, sy = sx) {
  return paths.map(p => ({ c: p.c, v: p.v.map(([px, py]) => [round(x + px * sx), round(y + py * sy)]), i: p.i.map(([px, py]) => [round(px * sx), round(py * sy)]), o: p.o.map(([px, py]) => [round(px * sx), round(py * sy)]) }));
}
function pathData(paths) {
  return paths.map(p => {
    let d = 'M' + p.v[0].join(' ');
    for (let i = 1; i < p.v.length + (p.c ? 1 : 0); i += 1) {
      const before = (i - 1) % p.v.length; const current = i % p.v.length;
      const start = p.v[before]; const end = p.v[current];
      d += 'C' + [round(start[0] + p.o[before][0]), round(start[1] + p.o[before][1]), round(end[0] + p.i[current][0]), round(end[1] + p.i[current][1]), ...end].join(' ');
    }
    return d + (p.c ? 'Z' : '');
  }).join('');
}
const linear = (start, end, stops) => ({ type: 'linear', start, end, stops });
const radial = (center, radius, stops) => ({ type: 'radial', start: center, end: [center[0] + radius, center[1]], stops });
function node(name, d, paint, options = {}) { return { name, paths: typeof d === 'string' ? parsePath(d) : d, paint, opacity: 100, ...options }; }
function rect(x, y, w, h) { return parsePath('M' + [x, y].join(' ') + 'L' + [x + w, y].join(' ') + 'L' + [x + w, y + h].join(' ') + 'L' + [x, y + h].join(' ') + 'Z'); }
function ellipse(cx, cy, rx, ry) {
  const k = 0.55228475;
  return [{ c: true, v: [[cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]], i: [[0, -ry * k], [rx * k, 0], [0, ry * k], [-rx * k, 0]], o: [[0, ry * k], [-rx * k, 0], [0, -ry * k], [rx * k, 0]] }];
}
function transformNode(n, x, y, sx, sy = sx) {
  const mapPaint = p => typeof p === 'string' || !p ? p : { ...p, start: [x + p.start[0] * sx, y + p.start[1] * sy], end: [x + p.end[0] * sx, y + p.end[1] * sy] };
  return { ...n, paths: mapPaths(n.paths, x, y, sx, sy), paint: mapPaint(n.paint), stroke: mapPaint(n.stroke), strokeWidth: (n.strokeWidth || 0) * Math.abs(sx) };
}
function master(p, { decorative = true } = {}) {
  if (p.mono) return [
    node('Hotel F with window and canopy cutouts and arched entrance', FACE + 'M82 170L116 146L151 170L151 179L82 179Z', p.ink),
    node('Peaked entrance canopy', CANOPY, p.ink),
    node('Curved road with two lane cutouts', ROAD + DASHES.join(''), p.ink),
  ];
  const bodyPaint = linear([85, 25], [177, 252], [[0, '#245E4B'], [0.24, '#0D4032'], [0.58, '#144A39'], [0.77, p.dark ? '#597550' : '#0B3D2C'], [1, p.dark ? '#F5D391' : '#235A40']]);
  const greenRoad = linear([150, 210], [169, 278], [[0, '#164D3A'], [0.3, '#286849'], [0.58, '#0B392C'], [0.85, '#123D2D'], [1, '#356447']]);
  const gold = linear([117, 151], [117, 180], [[0, '#FFF3CC'], [0.24, '#DCB468'], [0.62, '#B38337'], [0.84, '#CEA45C'], [1, '#6E481E']]);
  const parts = [
    node('Hotel depth', FACE, '#001E18', { offset: [1.1, 1.8], opacity: 65 }),
    node('Hotel facade', FACE, bodyPaint, { stroke: p.dark ? '#B3C5A3' : '#1D5540', strokeWidth: p.dark ? 0.8 : 0.65 }),
    node('Lower facade reflected warm light', FACE, radial([82, 248], 132, [[0, p.dark ? '#FFF3C6' : '#8B9D6B', p.dark ? 0.86 : 0.08], [0.45, '#D3AE6B', p.dark ? 0.26 : 0.025], [1, '#CBA25C', 0]])),
    node('Facade satin sheen', FACE, linear([66, 16], [248, 197], [[0, '#9CBCA0', 0.11], [0.22, '#9CBCA0', 0], [0.4, '#9CBCA0', 0.04], [0.57, '#9CBCA0', 0], [0.75, '#9CBCA0', 0.06], [1, '#9CBCA0', 0]])),
    node('Facade top left bevel', 'M80 247L80 22Q80 17 85 17L151 17', null, { stroke: p.dark ? '#E0E5BA' : '#4E8769', strokeWidth: 1.1, opacity: p.dark ? 78 : 42 }),
    node('Arm gold reflected bevel', 'M155 80L226 80C239 80 249 71 249 58M155 146L201 146C215 146 226 137 226 124', null, { stroke: p.dark ? '#D9BB75' : '#799579', strokeWidth: 0.85, opacity: p.dark ? 90 : 36 }),
  ];
  if (decorative) WINDOWS.forEach((window, index) => {
    const cy = index ? 107 : 61;
    parts.push(node('Window ' + (index + 1) + ' warm halo', ellipse(115.5, cy, 27, 27), radial([115.5, cy], 27, [[0, '#FFE5A1', 0.38], [0.4, '#F1BB62', 0.14], [1, '#EFB460', 0]])));
  });
  WINDOWS.forEach((window, index) => {
    const y = index ? 94 : 48;
    parts.push(node('Window ' + (index + 1) + ' brass recess', window, linear([104, y], [127, y + 26], [[0, '#EFC676'], [0.5, '#FFEDC3'], [1, '#B98533']])));
    parts.push(node('Window ' + (index + 1) + ' light', rect(105.7, y + 1.7, 19.6, 22.6), linear([105, y], [126, y + 26], [[0, '#FFFFEF'], [0.65, '#FFFADE'], [1, '#FBE7AA']])));
  });
  parts.push(
    node('Entrance arch bevel', DOOR_EDGE, null, { stroke: p.dark ? '#FFDFA4' : '#5C7B57', strokeWidth: p.dark ? 1.5 : 0.75 }),
    node('Canopy cast shadow', CANOPY, '#001D15', { offset: [0, 3.4], opacity: 64 }),
    node('Peaked brass entrance canopy', CANOPY, gold, { stroke: p.dark ? '#FFE2A8' : '#9C783B', strokeWidth: 0.75 }),
    node('Canopy dimensional front', CANOPY_FACE, gold),
    node('Canopy ivory upper bevel', 'M85 171L116 150L148 171', null, { stroke: '#FFF8E2', strokeWidth: 2.2, opacity: 95 }),
    node('Road warm rim glow outer', ROAD, null, { stroke: p.dark ? '#EAB162' : '#E8BF73', strokeWidth: p.dark ? 10 : 5, opacity: p.dark ? 3 : 2 }),
    node('Road warm rim glow inner', ROAD, null, { stroke: '#FFDD99', strokeWidth: 4, opacity: p.dark ? 9 : 3 }),
    node('Road depth', ROAD, '#01271D', { offset: [0, 1.5], opacity: 80 }),
    node('Sweeping green access road', ROAD, greenRoad, { stroke: p.dark ? '#E9C580' : '#164632', strokeWidth: p.dark ? 1.25 : 0.85 }),
    node('Road brass tip', ROAD_TIP, linear([255, 205], [297, 229], [[0, '#805421'], [0.38, '#D6AF63'], [0.7, '#F5D396'], [1, '#AA7430']]), { stroke: '#E6C385', strokeWidth: 0.65 }),
    node('Road upper light edge', ROAD_EDGE, null, { stroke: p.dark ? '#FFF8CE' : '#D1DDC7', strokeWidth: p.dark ? 1.6 : 1.2, opacity: p.dark ? 100 : 65 }),
  );
  DASHES.forEach((dash, index) => parts.push(node('Road dash ' + (index + 1), dash, '#FFFBEA')));
  if (decorative) {
    parts.push(node('Road arrival glint', ellipse(290, 223, 24, 24), radial([290, 223], 24, [[0, '#FFF9DF', p.dark ? 0.95 : 0.55], [0.07, '#FFE7AE', p.dark ? 0.85 : 0.3], [0.4, '#ECB35C', p.dark ? 0.15 : 0.06], [1, '#DDA358', 0]])));
    parts.push(node('Road entrance glint', ellipse(60, 264, 27, 27), radial([60, 264], 27, [[0, '#FFF6D2', p.dark ? 0.7 : 0.2], [0.05, '#FFF0C0', p.dark ? 0.55 : 0.1], [0.3, '#DC9D4C', p.dark ? 0.12 : 0.025], [1, '#DC9D4C', 0]])));
  }
  return parts;
}
let letterAdvance = 0;
const letters = wordmark.glyphs.map(glyph => {
  const letter = { ...glyph, x: letterAdvance, paths: parsePath(glyph.path) };
  letterAdvance += glyph.advance + LETTER_TRACKING;
  return letter;
});
const LETTER_LEFT = (360 - (letterAdvance - LETTER_TRACKING) * LETTER_SCALE) / 2;
function letterNodes(p, x = LETTER_LEFT, baseline = LETTER_BASELINE, scale = LETTER_SCALE, reflection = false) {
  return letters.map((letter, index) => {
    const paint = p.mono ? p.ink : linear([0, baseline - 55], [0, baseline + 4], p.dark
      ? [[0, '#FFF8E3'], [0.44, '#FBE4B5'], [0.75, '#E8C18A'], [1, '#C2975D']]
      : [[0, '#18513F'], [0.55, '#063B2D'], [1, '#002E24']]);
    return node((reflection ? 'Reflection' : 'Letter') + ' ' + (index + 1) + ' ' + letter.char, mapPaths(letter.paths, x + letter.x * scale, baseline, scale, reflection ? -scale * 0.64 : scale), paint, { letterIndex: index, fillRule: 'nonzero' });
  });
}
function launch(p) {
  const scene = [node('Stage background', rect(0, 0, 360, 640), p.ground)];
  if (!p.mono) {
    scene.push(node('Soft atmospheric light', rect(0, 0, 360, 640), radial([180, 343], 300, [[0, p.ambient, 0.9], [0.65, p.ambient, 0.35], [1, p.ground, 0]])));
    // Soft shadows use transparent ellipses, supported by native Lottie without SVG filters.
    for (let i = 0; i < 12; i += 1) scene.push(node('Mark floor shadow ' + i, ellipse(178, 438, 116 - i * 5, 16 - i * 0.8), p.dark ? '#CCA76A' : '#766140', { opacity: p.dark ? 0.75 : 0.65, phase: 'mark' }));
    for (let i = 0; i < 10; i += 1) scene.push(node('Wordmark floor light ' + i, ellipse(180, 491, 149 - i * 7, 25 - i * 1.4), p.dark ? '#DDAF67' : '#A79670', { opacity: p.dark ? 0.85 : 0.5, phase: 'reflection' }));
  }
  const mark = master(p).map(n => transformNode(n, MARK_PLACEMENT.x, MARK_PLACEMENT.y, MARK_PLACEMENT.scale));
  mark.forEach(n => { n.phase = n.name.startsWith('Road') || n.name.startsWith('Sweeping') ? 'road' : 'mark'; });
  scene.push(...mark);
  if (!p.mono) {
    scene.push(node('Hotel formation outline', mapPaths(parsePath(FACE), MARK_PLACEMENT.x, MARK_PLACEMENT.y), null, { stroke: p.dark ? '#F5CA79' : '#BFA16D', strokeWidth: 0.9, phase: 'outline' }));
    const route = 'M-120 467 C-3 458 76 447 139 420 C199 393 243 366 313 397';
    [10, 5, 1.5].forEach((width, index) => scene.push(node('Opening road light ' + (index + 1), route, null, { stroke: index === 2 ? '#FFF8D5' : '#F6BC62', strokeWidth: width, opacity: [8, 19, 95][index], phase: 'sweep', trim: true })));
    const reflection = letterNodes(p, LETTER_LEFT, LETTER_BASELINE + 8, LETTER_SCALE, true);
    reflection.forEach(n => {
      n.paint = linear([0, LETTER_BASELINE + 4], [0, LETTER_BASELINE + 46], [[0, p.dark ? '#E8C385' : '#355B47', p.dark ? 0.26 : 0.17], [0.55, p.dark ? '#BB975F' : '#355B47', 0.06], [1, p.ink, 0]]);
      n.phase = 'reflection';
    });
    // Three low-opacity copies soften reflection edges without nonportable blur effects.
    reflection.forEach(n => [[-0.7, 0.35], [0, 0], [0.7, -0.35]].forEach((offset, index) => {
      scene.push({ ...n, name: n.name + ' soft sample ' + (index + 1), offset, opacity: 100 / 3 });
    }));
    letterNodes(p).forEach(n => scene.push({ ...n, name: n.name + ' lower bevel', offset: [0.5, 1.1], paint: p.dark ? '#694F2D' : '#D6D4BC', opacity: p.dark ? 70 : 65, phase: 'letter' }));
  }
  scene.push(...letterNodes(p).map(n => ({ ...n, phase: 'letter' })));
  if (!p.mono) {
    [5, 1].forEach((width, index) => scene.push(node('Final gold light sweep ' + (index + 1), 'M-70 488L430 488', null, { stroke: index ? '#FFF0C1' : '#DDA45A', strokeWidth: width, opacity: index ? 72 : 16, phase: 'final-sweep', trim: true })));
    scene.push(node('Final sweep glint', ellipse(0, 0, 24, 24), radial([0, 0], 24, [[0, '#FFFADE', 0.9], [0.07, '#FFE3A0', 0.7], [0.3, '#D49B44', 0.2], [1, '#D49B44', 0]]), { phase: 'glint' }));
  }
  return scene;
}
const constant = k => ({ a: 0, k });
const rgba = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
function animated(values) {
  return { a: 1, k: values.map(([t, value], i) => {
    const s = Array.isArray(value) ? value : [value];
    if (i === values.length - 1) return { t, s };
    const next = values[i + 1][1];
    return { t, s, e: Array.isArray(next) ? next : [next], o: { x: [0.18], y: [0.05] }, i: { x: [0.3], y: [1] } };
  }) };
}
function opacityFor(n) {
  const high = n.opacity;
  switch (n.phase) {
    case 'road': return animated([[0, 0], [3, 0], [20, high], [114, high]]);
    case 'mark': return animated([[0, 0], [10, 0], [30, high], [114, high]]);
    case 'outline': return animated([[0, 0], [5, high], [15, high], [30, 0], [114, 0]]);
    case 'sweep': return animated([[0, 0], [3, high], [17, high], [28, 0], [114, 0]]);
    case 'letter': { const start = 36 + n.letterIndex * 4.5; return animated([[0, 0], [start, 0], [start + 6, high], [114, high]]); }
    case 'reflection': { const start = n.letterIndex === undefined ? 52 : 44 + n.letterIndex * 4.5; return animated([[0, 0], [start, 0], [start + 11, high], [114, high]]); }
    case 'final-sweep': return animated([[0, 0], [82, 0], [86, high], [97, high], [105, 0], [114, 0]]);
    case 'glint': return animated([[0, 0], [85, 0], [89, high], [97, high], [104, 0], [114, 0]]);
    default: return constant(high);
  }
}
// Put the shape discriminator first: older streaming renderers discard preceding style fields.
function lottiePaint(paint, stroke, width, rule = 2) {
  if (!paint) return [];
  const common = { nm: stroke ? 'Vector edge' : 'Vector face', o: constant(100), ...(stroke ? {} : { r: rule }) };
  const edge = stroke ? { w: constant(width), lc: 2, lj: 2, ml: 4 } : {};
  if (typeof paint === 'string') return [{ ty: stroke ? 'st' : 'fl', ...common, ...edge, c: constant([...rgba(paint), 1]) }];
  const colors = paint.stops.flatMap(([offset, hex]) => [offset, ...rgba(hex)]);
  const opacity = paint.stops.flatMap(([offset, , alpha = 1]) => [offset, alpha]);
  return [{ ty: stroke ? 'gs' : 'gf', ...common, ...edge, t: paint.type === 'radial' ? 2 : 1, s: constant(paint.start), e: constant(paint.end), h: constant(0), a: constant(0), g: { p: paint.stops.length, k: constant([...colors, ...opacity]) } }];
}
function reveal(p) {
  const layers = launch(p).map((n, index) => {
    const offset = n.offset || [0, 0];
    let position = constant([...offset, 0]);
    if (n.phase === 'letter') {
      const start = 36 + n.letterIndex * 4.5;
      position = animated([[0, [offset[0], offset[1] - 25, 0]], [start, [offset[0], offset[1] - 25, 0]], [start + 10.8, [...offset, 0]], [114, [...offset, 0]]]);
    } else if (n.phase === 'glint') position = animated([[0, [-35, 488, 0]], [85, [-35, 488, 0]], [104, [395, 488, 0]], [114, [395, 488, 0]]]);
    const shapes = n.paths.map((geometry, i) => ({ ty: 'sh', nm: 'Master contour ' + (i + 1), ks: constant(geometry) }));
    shapes.push(...lottiePaint(n.paint, false, 0, n.fillRule === 'nonzero' ? 1 : 2), ...lottiePaint(n.stroke, true, n.strokeWidth));
    if (n.trim) {
      const start = n.phase === 'sweep' ? 0 : 83; const end = n.phase === 'sweep' ? 24 : 104;
      shapes.push({ ty: 'tm', nm: 'Light travels along the road', s: animated([[0, 0], [start + 5, 0], [end, 100], [114, 100]]), e: animated([[0, 0], [start + 1, 0], [end - 5, 100], [114, 100]]), o: constant(0), m: 1 });
    }
    return { ddd: 0, ind: index + 1, ty: 4, nm: n.name, sr: 1, ks: { o: opacityFor(n), r: constant(0), p: position, a: constant([0, 0, 0]), s: constant([100, 100, 100]) }, ao: 0, shapes, ip: 0, op: FRAME_COUNT, st: 0, bm: 0 };
  }).reverse();
  return { v: '5.12.2', fr: 60, ip: 0, op: FRAME_COUNT, w: 360, h: 640, nm: 'FleetOps Hotel Route arrival', ddd: 0, assets: [], layers, markers: [
    { tm: 0, cm: 'Road light sweep', dr: 24 }, { tm: 10, cm: 'Hotel facade forms', dr: 20 },
    ...letters.map((letter, i) => ({ tm: 36 + i * 4.5, cm: 'Letter ' + (i + 1) + ' ' + letter.char + ' drop', dr: 10.8 })),
    { tm: 83, cm: 'Final gold sweep', dr: 22 }, { tm: 105, cm: 'Quiet final hold', dr: 9 },
  ] };
}
function renderScene(scene, viewBox = '0 0 360 640', width = 720, height = 1280) {
  let counter = 0; const defs = [];
  const paint = value => {
    if (!value) return 'none'; if (typeof value === 'string') return value;
    const id = 'paint' + counter++;
    const stops = value.stops.map(([offset, hex, alpha = 1]) => '<stop offset="' + offset + '" stop-color="' + hex + '" stop-opacity="' + alpha + '"/>').join('');
    defs.push(value.type === 'radial'
      ? '<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + value.start[0] + '" cy="' + value.start[1] + '" r="' + Math.hypot(value.end[0] - value.start[0], value.end[1] - value.start[1]) + '">' + stops + '</radialGradient>'
      : '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + value.start[0] + '" y1="' + value.start[1] + '" x2="' + value.end[0] + '" y2="' + value.end[1] + '">' + stops + '</linearGradient>');
    return 'url(#' + id + ')';
  };
  const body = scene.filter(n => !['outline', 'sweep', 'final-sweep', 'glint'].includes(n.phase)).map(n => '<path d="' + pathData(n.paths) + '" fill="' + paint(n.paint) + '" fill-rule="' + (n.fillRule || 'evenodd') + '" stroke="' + paint(n.stroke) + '" stroke-width="' + (n.strokeWidth || 0) + '" stroke-linecap="round" stroke-linejoin="round" opacity="' + n.opacity / 100 + '"' + (n.offset ? ' transform="translate(' + n.offset.join(' ') + ')"' : '') + '/>').join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="' + viewBox + '" role="img" aria-label="FleetOps"><defs>' + defs.join('') + '</defs>' + body + '</svg>\n';
}
async function saveText(name, content) { await writeFile(path.join(output, name), content, 'utf8'); }
async function bitmap(name, source, { width = 640, height = width, native = false, opaque = false } = {}) {
  let renderer = sharp(Buffer.from(source, 'utf8')).resize(width, height);
  if (opaque) renderer = renderer.removeAlpha();
  const png = await renderer.png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(native ? nativeOutput : output, name), png);
  const info = await sharp(png).metadata(); assert.equal(info.width, width); assert.equal(info.height, height);
  return png;
}
for (const [variant, palette] of Object.entries(palettes)) {
  const mark = master(palette);
  const markSvg = renderScene(mark, MARK_BOUNDS.join(' '), 640, 640);
  await saveText('mark-' + variant + '.svg', markSvg);
  await bitmap('mark-' + variant + '.png', markSvg);
  const lockup = [...mark.map(n => transformNode(n, 0, 0, 0.65)), ...letterNodes(palette, 218, 133, 0.7)];
  await saveText('lockup-' + variant + '.svg', renderScene(lockup, '12 5 545 190', 1090, 380));
  const finalSvg = renderScene(launch(palette));
  await saveText('launch-' + variant + '.svg', finalSvg);
  await bitmap('launch-' + variant + '.png', finalSvg, { width: 720, height: 1280, opaque: true });
  const animation = reveal(palette);
  assert.equal(animation.fr, 60); assert.equal(animation.op, 114); assert.equal(animation.assets.length, 0);
  assert.equal(animation.layers.filter(l => /^Letter \d [FletOps]$/.test(l.nm)).length, 8);
  assert.equal(animation.w, 360); assert.equal(animation.h, 640);
  for (let i = 0; i < letters.length; i += 1) {
    const layer = animation.layers.find(l => l.nm === 'Letter ' + (i + 1) + ' ' + letters[i].char);
    assert.equal(layer.ks.p.k[1].t, 36 + i * 4.5, 'Fixed 75 ms letter stagger');
    assert.equal(round(layer.ks.p.k[2].t - layer.ks.p.k[1].t), 10.8, 'Each drop takes 180 ms');
    assert.deepEqual(layer.ks.p.k[2].s, [0, 0, 0], 'Each letter lands at its final fixed position');
    assert.equal(layer.shapes.at(-1).r, 1, 'Outlines use nonzero fill for overlapping font contours');
  }
  assert.ok(!JSON.stringify(animation).includes('"ef":'), 'No renderer-specific effects');
  animation.layers.forEach(layer => layer.shapes.forEach(shape => {
    assert.equal(Object.keys(shape)[0], 'ty', 'Shape type must precede properties for streaming native renderers');
    if (shape.ty === 'st' || shape.ty === 'gs') {
      assert.ok(shape.w.k > 0, 'All highlighted edges have positive width');
      assert.equal(shape.r, undefined, 'Fill winding rules do not belong on strokes');
    }
  }));
  if (!palette.mono) assert.equal(animation.layers.filter(l => /^Road dash \d$/.test(l.nm)).length, 2);
  await saveText('route-reveal-' + variant + '.json', JSON.stringify(animation) + '\n');
}
// Native icons keep the same filenames and remain in Android's central safe region.
const iconScene = master(palettes.light, { decorative: false }).map(n => transformNode(n, 62, 62, 0.6));
const iconBackground = node('Ivory background', rect(0, 0, 320, 320), palettes.light.ground);
for (const name of ['fleetops-icon.png', 'icon.png']) await bitmap(name, renderScene([iconBackground, ...iconScene], '0 0 320 320', 1024, 1024), { width: 1024, native: true, opaque: true });
await bitmap('android-icon-foreground.png', renderScene(iconScene, '0 0 320 320', 1024, 1024), { width: 1024, native: true });
const monoScene = master(palettes['high-contrast-dark']).map(n => transformNode(n, 62, 62, 0.6));
const monoBuffer = await bitmap('android-icon-monochrome.png', renderScene(monoScene, '0 0 320 320', 1024, 1024), { width: 1024, native: true });
const { data: pixels, info } = await sharp(monoBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let minX = 1024; let minY = 1024; let maxX = 0; let maxY = 0;
for (let i = 0; i < pixels.length; i += 4) {
  if (!pixels[i + 3]) continue;
  assert.deepEqual([...pixels.subarray(i, i + 3)], [255, 255, 255], 'Monochrome icon is white and alpha only');
  const pixel = i / 4; const x = pixel % info.width; const y = Math.floor(pixel / info.width);
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}
assert.ok(minX >= 210 && minY >= 210 && maxX <= 814 && maxY <= 814, 'Adaptive mark remains inside safe area');
await bitmap('android-icon-background.png', renderScene([iconBackground], '0 0 320 320', 1024, 1024), { width: 1024, native: true, opaque: true });
await bitmap('favicon.png', renderScene(master(palettes.light, { decorative: false }), MARK_BOUNDS.join(' '), 64, 64), { width: 64, native: true });
// Expo's Android generator fits artwork inside a square before composing its 288dp canvas.
// Keep the native splash a centered square mark at the existing imageWidth 160.
// The operating-system splash is static; the full scene starts after native dismissal.
for (const variant of ['light', 'dark']) {
  await bitmap('splash-mark-' + variant + '.png', renderScene(master(palettes[variant]), MARK_BOUNDS.join(' '), 640, 640));
}
const boardScene = Object.values(palettes).flatMap((p, i) => launch(p).map(n => transformNode(n, (i % 2) * 360, Math.floor(i / 2) * 640, 1)));
const boardSvg = renderScene(boardScene, '0 0 720 1280', 720, 1280);
await saveText('preview.svg', boardSvg);
await bitmap('brand-board.png', boardSvg, { width: 720, height: 1280, opaque: true });
console.log('Generated Hotel Route: four self-contained 360x640 Lotties at 60 fps / 1,900 ms, matching final compositions and native assets.');
console.log('Adaptive alpha bounds ' + minX + '..' + maxX + ', ' + minY + '..' + maxY + '; letters start at 600 ms + 75 ms each, settle over 180 ms.');
await generateReferenceBrand(root, output);
