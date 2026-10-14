// Exact display-name aliases select illustrative art, never source/evidence records.
const tomatoes = require('../assets/images/cargo-guides/tomato-example.webp');
const potatoes = require('../assets/images/cargo-guides/potato-example.webp');
const packages = require('../assets/images/cargo-guides/package-example.webp');

export function cargoItemIllustrationFor(name) {
  const normalized = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const source = ['tomato', 'tomatoes'].includes(normalized) ? tomatoes
    : ['potato', 'potatoes'].includes(normalized) ? potatoes : packages;
  const kind = source === packages ? 'packaging' : 'item';
  return { source, caption: `AI-generated ${kind} illustration only — not this shipment’s actual contents, packaging, quantity or condition.` };
}
