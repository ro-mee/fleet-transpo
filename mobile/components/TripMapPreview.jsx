import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme-context';
import { palettes } from '../lib/theme';
import { previewDocument, previewEndpoints } from '../lib/trip-map-preview';

export default function TripMapPreview({ trip, offline, airport = false }) {
  const { colors, type } = useTheme();
  const [state, setState] = useState('loading');
  const key = process.env.EXPO_PUBLIC_TOMTOM_API_KEY;
  const points = previewEndpoints(trip);
  const html = useMemo(() => points && key ? previewDocument(points, key, airport) : null,
    // Stable primitive coordinates prevent map reloads on Home clock ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip?.origin_latitude, trip?.origin_longitude, trip?.destination_latitude, trip?.destination_longitude, key, airport]);
  useEffect(() => { const timer = setTimeout(() => setState(s => s === 'loading' ? 'unavailable' : s), 20000); return () => clearTimeout(timer); }, []);
  const available = html && !offline && state !== 'unavailable';
  return <View style={[s.shell, { shadowColor: colors.shadow, backgroundColor: colors.surfaceContainerLow, borderTopColor: colors.surfaceBright, borderBottomColor: colors.outlineVariant }]}>
    <View style={s.clip} pointerEvents="none" accessibilityLabel={state === 'ready' && available ? 'Road route from pickup to destination' : 'Route preview unavailable'}>
      {available && <WebView source={{ html }} style={s.map} scrollEnabled={false} bounces={false}
        onMessage={e => { if (['ready', 'unavailable'].includes(e.nativeEvent.data)) setState(e.nativeEvent.data); }}
        onError={() => setState('unavailable')} onHttpError={() => setState('unavailable')} />}
      {(!available || state !== 'ready') && <View style={[StyleSheet.absoluteFill, s.message]}>
        <Ionicons name="map-outline" size={25} color="#285448" />
        <Text style={[type.caption, { color: '#52665E', textAlign: 'center' }]}>{available ? 'Loading route…' : 'Route preview unavailable'}</Text>
      </View>}
    </View>
  </View>;
}
const s = StyleSheet.create({
  shell: { width: '100%', aspectRatio: 1.9, borderRadius: 22, padding: 5, borderTopWidth: 2, borderBottomWidth: 3, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.24, shadowRadius: 12, elevation: 7 },
  clip: { flex: 1, borderRadius: 17, overflow: 'hidden', backgroundColor: palettes.light.background },
  map: { flex: 1, backgroundColor: palettes.light.background },
  message: { backgroundColor: palettes.light.background, justifyContent: 'center', alignItems: 'center', padding: 10, gap: 6 },
});
