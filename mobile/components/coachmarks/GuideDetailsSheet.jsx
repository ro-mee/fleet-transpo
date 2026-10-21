import React from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../lib/theme-context';
import { ClayButton } from '../clay';

export default function GuideDetailsSheet({ visible, title, body, onClose }) {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
    <View style={[styles.backdrop, { backgroundColor: colors.scrim ? `${colors.scrim}A6` : '#000000A6', paddingTop: insets.top + 16 }]}>
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(16, insets.bottom) }]}>
        <Text accessibilityRole="header" style={[type.headlineMd, { color: colors.onSurface }]}>{title}</Text>
        <ScrollView contentContainerStyle={styles.details}>
          <Text style={[type.bodyMd, { color: colors.onSurface }]}>{body}</Text>
        </ScrollView>
        <ClayButton label="Back to guide" onPress={onClose} />
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', padding: 20, gap: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  details: { paddingBottom: 12 },
});
