import { Platform } from 'react-native';
import { clayMaterials } from '../../lib/clay';

// Home-only molded material. Older Android / legacy renderers retain the
// existing elevation recipe; inset shadows require Fabric and Android 10+.
export function homeMaterials(isDark) {
  const base = clayMaterials(isDark);
  const supported = Platform.OS === 'web' || (global.nativeFabricUIManager != null && (Platform.OS !== 'android' || Number(Platform.Version) >= 29));
  if (!supported) return base;
  const highlight = isDark ? 'rgba(220,240,229,0.07)' : 'rgba(255,255,255,0.92)';
  const shade = isDark ? 'rgba(0,0,0,0.48)' : 'rgba(83,74,53,0.20)';
  const molded = (material, offset, blur) => ({
    ...material, elevation: 0, shadowOpacity: 0, borderWidth: 0,
    borderTopWidth: 0, borderBottomWidth: 0,
    boxShadow: `2px ${offset}px ${blur}px ${shade}, -2px -3px ${blur / 2}px ${highlight}, inset 1px 2px 4px ${highlight}, inset -2px -3px 7px ${base.clayTile.borderBottomColor}`,
  });
  return { ...base, clayShade: molded(base.clayShade, 7, 14), compactShade: molded(base.compactShade, 4, 8), clayTile: molded(base.clayTile, 4, 7) };
}
