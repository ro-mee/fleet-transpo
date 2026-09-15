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
