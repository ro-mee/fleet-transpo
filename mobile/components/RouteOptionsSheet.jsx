import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme-context';
import { ClayCard, ClayButton } from './clay';

// Shared by both load types; these choices affect routing, never trip authority.
export default function RouteOptionsSheet({ visible, routes, preferences, phase, disabledReason, onClose, onApply }) {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(preferences);
  const busy = phase === 'refreshing';
  const sameAvoidance = draft.avoidTolls === preferences.avoidTolls;
  const choices = sameAvoidance ? routes : [];
  const selectedIndex = choices.some(route => route.index === draft.selectedIndex) ? draft.selectedIndex : 0;
  return <Modal visible={visible} transparent animationType="none" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={s.backdrop}>
      <ClayCard variant="standard" style={[s.sheet, { backgroundColor: colors.surfaceContainerLow, marginTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View accessibilityViewIsModal style={s.content}>
          <View style={s.header}>
            <Text accessibilityRole="header" style={[type.cardTitle, s.flex]}>Route options</Text>
            <Pressable onPress={onClose} disabled={busy} accessibilityState={{ disabled: busy }} accessibilityRole="button" accessibilityLabel="Close route options" style={s.close}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.content}>
            <Text style={type.supporting}>Choose a route for the current pickup or delivery. Trip checks still apply.</Text>
            {choices.length ? choices.map(route => <Pressable key={route.index} onPress={() => setDraft(value => ({ ...value, selectedIndex: route.index }))} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: selectedIndex === route.index, disabled: busy }} style={[s.choice, { backgroundColor: selectedIndex === route.index ? colors.primaryContainer : colors.surface, borderColor: selectedIndex === route.index ? colors.primary : colors.outlineVariant }]}>
              <Ionicons name={selectedIndex === route.index ? 'radio-button-on' : 'radio-button-off'} size={24} color={colors.primary} />
              <View style={s.flex}>
                <Text style={type.labelLg}>{route.index === 0 ? 'Recommended route' : `Alternate route ${route.index}`}</Text>
                <Text style={type.supporting}>{Math.ceil(route.travelTimeInSeconds / 60)} min · {(route.lengthInMeters / 1000).toFixed(1)} km</Text>
              </View>
            </Pressable>) : <Text style={type.supporting}>{sameAvoidance ? 'No route available yet. Apply to retry.' : 'Apply to calculate routes with this toll preference.'}</Text>}
            {sameAvoidance && choices.length === 1 ? <Text style={type.supporting}>TomTom returned no alternate routes.</Text> : null}
            <View style={s.toggleRow}>
              <Text style={[type.labelLg, s.flex]}>Avoid toll roads</Text>
              <Switch value={draft.avoidTolls} disabled={busy} onValueChange={avoidTolls => setDraft({ avoidTolls, selectedIndex: 0 })} accessibilityLabel="Avoid toll roads" trackColor={{ false: colors.outlineVariant, true: colors.primary }} thumbColor={colors.surface} />
            </View>
            <Text style={type.supporting}>TomTom will try to avoid toll roads. This preference lasts for this trip.</Text>
            {phase === 'failed' ? <Text accessibilityLiveRegion="polite" style={[type.supporting, { color: colors.error }]}>Route update failed. Any previous route and its applied settings are retained. Apply to retry.</Text> : null}
            {disabledReason ? <Text style={type.supporting}>{disabledReason}</Text> : null}
          </ScrollView>
          <ClayButton label={busy ? 'Recalculating…' : 'Apply route'} loading={busy} disabled={busy || !!disabledReason} onPress={() => onApply({ ...draft, selectedIndex })} />
          <ClayButton label="Cancel" variant="secondary" disabled={busy} onPress={onClose} />
        </View>
      </ClayCard>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)', padding: 12 },
  sheet: { maxHeight: '85%', flexShrink: 1 }, content: { gap: 12, flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, flex: { flex: 1, minWidth: 0 },
  close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  choice: { minHeight: 64, padding: 12, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
