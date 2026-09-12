import { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { useSettings } from '../../lib/settings-context';
import WeatherChip from '../WeatherChip';
import { homeMaterials as clayMaterials } from './materials';

// Memoized with the cards: stable weather object + callbacks from the
// parent let the header skip poster/notification/clock ticks.
export default memo(function DriverHomeHeader({ driverName, initial, weather, unreadCount, topInset, onProfile, onNotifications }) {
  const { colors, type, scheme } = useTheme();
  const { settings } = useSettings();
  const { width, fontScale } = useWindowDimensions();
  const stacked = !!weather && (width < 430 || fontScale > 1.15 || settings.textSize === 'large');
  const mats = clayMaterials(scheme === 'dark');
  const count = Math.max(0, Number(unreadCount) || 0);
  const shadow = { shadowColor: colors.shadow, shadowOpacity: settings.highContrast ? 0 : scheme === 'dark' ? 0.35 : 0.17 };
  // Avatar sheen: on the forest avatar (colors.primary) the white gradient is
  // the light recipe; in dark the primary flips to pale sage, so the sheen
  // drops to a whisper and the bottom shade deepens instead.
  const sheen = scheme === 'dark' ? ['rgba(255,253,252,0.10)', 'rgba(255,253,252,0)', 'rgba(0,0,0,0.22)'] : ['#FFFFFF24', '#FFFFFF00', '#00000016'];
  return <View style={[s.header, { paddingTop: topInset + 4, backgroundColor: colors.background }]}>
    <View style={[s.identity, stacked && { flexBasis: '100%' }]}>
      <Pressable onPress={onProfile} accessibilityRole="button" accessibilityLabel="Open profile" style={({ pressed }) => [s.avatar, { ...s.raised, ...shadow, borderColor: colors.surfaceContainerLow, backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
        {!settings.highContrast && Platform.OS !== 'android' && <LinearGradient pointerEvents="none" colors={sheen} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} />}
        <Text style={[type.titleLg, { color: colors.onPrimary, fontSize: 20, lineHeight: 24 }]}>{initial || 'D'}</Text>
      </Pressable>
      <View style={s.copy}>
        <Text style={[type.titleLg, { fontSize: 18, lineHeight: 22 }]}>Hi, {driverName}</Text>
      </View>
    </View>
    <View style={[s.utilities, stacked && { marginLeft: 'auto' }]}>
      <WeatherChip value={weather} compact={!stacked && width < 520} />
      <Pressable onPress={onNotifications} accessibilityRole="button" accessibilityLabel={`Notifications${count ? `, ${count} unread` : ', no unread notifications'}`} style={({ pressed }) => [s.bell, { ...shadow, ...mats.clayTile, backgroundColor: colors.surfaceContainerLow, opacity: pressed ? 0.8 : 1 }]}>
        <Ionicons name="notifications-outline" size={20} color={colors.primary} />
        {count > 0 && <View style={[s.badge, { backgroundColor: colors.error, borderColor: colors.background }]}><Text style={[type.caption, s.badgeText, { color: colors.onError }]}>{count > 99 ? '99+' : count}</Text></View>}
      </Pressable>
    </View>
  </View>;
});

const s = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  identity: { flex: 1, minWidth: 100, flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { flex: 1, minWidth: 0 },
  raised: { shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 3 },
  avatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  utilities: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bell: { width: 48, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -4, top: -5, minWidth: 20, minHeight: 20, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontWeight: '700', fontSize: 10, lineHeight: 14 },
});
