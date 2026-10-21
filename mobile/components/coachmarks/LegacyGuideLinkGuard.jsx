import React from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DRIVER_GUIDES_V2 } from '../../lib/driver-guidance-config';
import { useTheme } from '../../lib/theme-context';
import { ClayButton } from '../clay';

export function isLegacyGuideLink(params = {}) {
  return ['tour', 'walkthrough', 'tutorial'].some(key => params[key] != null) || params.pretrip === 'passed';
}

// Decide before the operational screen is mounted, so a URL is never a sample
// capability and cannot seed approvals or initialize native/operational effects.
export function guardLegacyGuideLinks(Screen) {
  if (!DRIVER_GUIDES_V2) return Screen;
  return function GuardedGuideScreen(props) {
    const params = useLocalSearchParams(), router = useRouter();
    const { type, colors } = useTheme();
    if (!isLegacyGuideLink(params)) return <Screen {...props} />;
    return <View style={{ flex: 1, padding: 24, gap: 20, backgroundColor: colors.background }}>
      <Text accessibilityRole="header" style={type.headlineMd}>Open practice from Help</Text>
      <Text style={type.bodyMd}>This older tutorial link cannot start practice. Open Help & Support, choose one section and confirm that you are safely parked. Real assignments and approvals must come from Fleet.</Text>
      <ClayButton label="Open Help & Support" onPress={() => router.replace('/profile/help')} />
    </View>;
  };
}
