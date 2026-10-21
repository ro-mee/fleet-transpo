import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../lib/theme-context';
import { ClayButton } from '../clay';

export default function PracticeBanner({ onExit }) {
  const { colors, type } = useTheme();
  return <View style={[styles.banner, { backgroundColor: colors.primaryContainer }]}>
    <View style={{ flex: 1, minWidth: 120 }}>
      <Text style={[type.labelLg, { color: colors.onPrimaryContainer }]}>Practice mode - Sample data</Text>
      <Text style={[type.supporting, { color: colors.onPrimaryContainer }]}>Nothing here will be submitted.</Text>
    </View>
    <ClayButton label="Exit practice" variant="tonal" onPress={onExit} />
  </View>;
}
const styles = StyleSheet.create({ banner: { padding: 16, gap: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' } });
