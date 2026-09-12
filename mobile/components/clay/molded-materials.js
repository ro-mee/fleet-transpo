import { Platform } from 'react-native';
import { clayMaterials, raisedControl, pillEdges } from '../../lib/clay';

const _cache = {};

/**
 * Universal molded claymorphism material engine.
 * Mirrors the notification bell's tactile dual-pass boxShadow (drop-shadow + inset highlight)
 * supported natively by Fabric / Android 10+ and Web, with a graceful fallback to
 * directional border strips on legacy renderers.
 *
 * @param {boolean} isDark Whether dark scheme is active
 */
export function moldedMaterials(isDark) {
  const key = isDark ? 'dark' : 'light';
  if (_cache[key]) return _cache[key];

  const base = clayMaterials(isDark);
  const supported =
    Platform.OS === 'web' ||
    (global.nativeFabricUIManager != null &&
      (Platform.OS !== 'android' || Number(Platform.Version) >= 29));

  if (!supported) {
    return (_cache[key] = {
      ...base,
      supported: false,
      clayButton: raisedControl(isDark),
      clayPill: pillEdges(isDark),
      clayInput: {
        borderWidth: 1,
        borderTopWidth: 1.5,
        borderBottomWidth: 2,
      },
    });
  }

  const highlight = isDark ? 'rgba(220,240,229,0.07)' : 'rgba(255,255,255,0.92)';
  const shade = isDark ? 'rgba(0,0,0,0.48)' : 'rgba(83,74,53,0.20)';
  const inputShade = isDark ? 'rgba(0,0,0,0.40)' : 'rgba(83,74,53,0.12)';

  const molded = (material, offset, blur, insetBlur = 4) => ({
    ...material,
    elevation: 0,
    shadowOpacity: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    borderTopWidth: 0,
    borderBottomWidth: 0,
    boxShadow: `2px ${offset}px ${blur}px ${shade}, inset 1px 2px ${insetBlur}px ${highlight}`,
  });

  return (_cache[key] = {
    ...base,
    supported: true,
    clayShade: molded(base.clayShade, 7, 14, 5),
    compactShade: molded(base.compactShade, 4, 8, 4),
    clayTile: molded(base.clayTile, 4, 7, 4),
    clayButton: molded(raisedControl(isDark), 4, 8, 4),
    clayPill: molded(pillEdges(isDark), 2, 5, 3),
    clayInput: {
      borderWidth: 0,
      borderColor: 'transparent',
      borderTopWidth: 0,
      borderBottomWidth: 0,
      boxShadow: `inset 1px 2px 4px ${inputShade}, 0 1px 2px ${highlight}`,
    },
  });
}
