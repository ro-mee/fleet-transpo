// Bundled illustrative cues, never operating evidence or certified safety examples.
const tire = require('../assets/images/cargo-guides/tire-example.webp');
const load = require('../assets/images/cargo-guides/load-example.webp');

export function inspectionReferenceFor(itemId) {
  const source = itemId === 'brakes_tires' ? tire : itemId === 'cargo_secure' ? load : null;
  return { source, caption: 'AI-generated illustration only — not your vehicle or proof of safety. Inspect the actual vehicle and load using Fleet guidance.' };
}
