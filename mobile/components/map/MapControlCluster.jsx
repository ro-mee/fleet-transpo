import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';

export default function MapControlCluster({ controls, buttonStyle }) {
  const { colors } = useTheme();
  return <>{controls.map(control => <Pressable key={control.id} style={[styles.button, { backgroundColor: colors.surfaceContainerLow }, buttonStyle, control.disabled && { opacity: 0.55 }]} onPress={control.onPress} disabled={control.disabled === true} accessibilityRole="button" accessibilityLabel={control.label} accessibilityState={{ disabled: control.disabled === true }}>
    <Ionicons name={control.icon} size={20} color={control.color || colors.primary} />
  </Pressable>)}</>;
}
const styles = StyleSheet.create({ button: { width: 48, height: 48, borderRadius: 18, justifyContent: 'center', alignItems: 'center' } });
