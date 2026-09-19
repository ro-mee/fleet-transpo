import { dispatchDecision } from '@/lib/dispatch/decision';
export const optionKey = p => `${p?.vehicle_id}:${p?.driver_id}`;
export function deriveOptions({ candidates = [], recommended, proposalPair, pinnedKeys = null }) {
  const recommendedKey = optionKey(recommended ?? proposalPair);
  const unique = new Map();
  for (const pair of [proposalPair, recommended, ...candidates].filter(Boolean)) if (!unique.has(optionKey(pair))) unique.set(optionKey(pair),pair);
  if (pinnedKeys) return pinnedKeys.map((key,index) => {
    const pair = unique.get(key);
    const [vehicle_id,driver_id] = key.split(':').map(Number);
    return {key,index,pair:pair ?? {vehicle_id,driver_id,evaluated:false,unavailable:true},unavailable:!pair,recommended:!!pair && key === recommendedKey};
  });
  const pairs = [...unique.values()];
  return pairs.filter(p => dispatchDecision(p).state !== 'BLOCKED').slice(0, 2).map((pair, index) => ({pair, index, key:optionKey(pair),recommended:optionKey(pair) === recommendedKey}));
}

// Which option a remembered selection resolves to, or null if nothing was
// remembered or its pair can no longer be offered.
//
// `derive` is the caller's own option derivation, so a restored choice is matched
// against a list built by exactly the rule that built it originally. Feeding back
// the remembered `pinnedKeys` keeps the card's identity and number stable, and is
// what lets a pair that is no longer a candidate still resolve at all — as an
// unavailable option, which the selection check then refuses. Deriving without
// the pin would silently drop the dispatcher's choice the moment the engine's
// ranking shifted, which is the failure this exists to prevent.
export function resolveRememberedOption(remembered, derive) {
  if (!remembered || typeof remembered.key !== 'string' || typeof derive !== 'function') return null;
  const pinned = Array.isArray(remembered.pinnedKeys) && remembered.pinnedKeys.length ? remembered.pinnedKeys : null;
  return derive(pinned).find(o => o.key === remembered.key) ?? null;
}
