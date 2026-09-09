import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { useSettings } from '../../lib/settings-context';
import WeatherChip from '../WeatherChip';

export default function DriverHomeHeader({ driverName, initial, weather, unreadCount, topInset, onProfile, onNotifications }) {
  const { colors, type } = useTheme();
  const { settings } = useSettings();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 380 || fontScale > 1.15 || settings.textSize === 'large';
  const count = Math.max(0, Number(unreadCount) || 0);
  const shadow = { shadowColor: colors.shadow, shadowOpacity: settings.highContrast ? 0 : 0.17 };
  return <View style={[s.header, { paddingTop: topInset + 8, backgroundColor: colors.background }]}>
    <View style={[s.identity, stacked && { flexBasis: '100%' }]}>
      <Pressable onPress={onProfile} accessibilityRole="button" accessibilityLabel="Open profile" style={({ pressed }) => [s.avatar, s.raised, shadow, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
        {!settings.highContrast && <LinearGradient pointerEvents="none" colors={['#FFFFFF24', '#FFFFFF00', '#00000016']} style={[StyleSheet.absoluteFill, { borderRadius: 17 }]} />}
        <Text style={[type.titleLg, { color: colors.onPrimary, fontSize: 26, lineHeight: 32 }]}>{initial || 'D'}</Text>
      </Pressable>
      <View style={s.copy}>
        <Text style={[type.titleLg, { fontSize: 18, lineHeight: 24 }]}>Hi, {driverName}</Text>
        <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>Drive safe. Every trip matters.</Text>
      </View>
    </View>
    <View style={[s.utilities, stacked && { marginLeft: 'auto' }]}>
      <WeatherChip value={weather} compact={!stacked && width < 520} />
      <Pressable onPress={onNotifications} accessibilityRole="button" accessibilityLabel={`Notifications${count ? `, ${count} unread` : ', no unread notifications'}`} style={({ pressed }) => [s.bell, s.raised, shadow, { backgroundColor: colors.surfaceContainerLow, opacity: pressed ? 0.8 : 1 }]}>
        <Ionicons name="notifications-outline" size={26} color={colors.primary} />
        {count > 0 && <View style={[s.badge, { backgroundColor: colors.error, borderColor: colors.background }]}><Text style={[type.caption, s.badgeText, { color: colors.onError }]}>{count > 99 ? '99+' : count}</Text></View>}
      </Pressable>
    </View>
  </View>;
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  identity: { flex: 1, minWidth: 100, flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  raised: { shadowOffset: { width: 0, height: 5 }, shadowRadius: 9, elevation: 4 },
  avatar: { width: 50, minHeight: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  utilities: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bell: { width: 50, minHeight: 52, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -4, top: -6, minWidth: 23, minHeight: 23, borderRadius: 16, borderWidth: 2, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontWeight: '700', fontSize: 11, lineHeight: 16 },
});
