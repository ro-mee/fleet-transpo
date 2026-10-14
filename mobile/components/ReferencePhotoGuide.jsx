import { useState } from 'react';
import { View, Text, Image, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme-context';

function ReferencePhoto({ source, subject }) {
  const { colors, type } = useTheme();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  if (failed) return <Text accessibilityRole="alert" style={[type.supporting, { color: colors.onSurfaceVariant }]}>Reference image unavailable. Continue using the written instructions.</Text>;
  return <View style={[styles.frame, { backgroundColor: colors.surfaceContainerLow }]}>
    <Image source={source} resizeMode="contain" accessibilityLabel={`Reference example for ${subject}, not actual inspection evidence`} style={styles.image} onLoad={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false); }} />
    {loading && <ActivityIndicator accessibilityLabel="Loading reference image" color={colors.primary} style={styles.loading} />}
  </View>;
}

export function ReferencePhotoGuide({ source, subject, caption = 'Reference only — not your vehicle’s current condition.', children }) {
  const { colors, type } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const sourceKey = typeof source === 'number' ? String(source) : source?.uri || '';
  const label = expanded ? source ? 'Hide example' : 'Hide guide' : source ? 'View example' : 'View guide';
  return <View style={styles.guide}>
    {!source && <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>Reference image unavailable</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${subject}`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[type.labelMd, { color: colors.primary, textDecorationLine: 'underline', flexShrink: 1 }]}>{label}</Text>
    </Pressable>
    {expanded && <View style={styles.detail}>
      {source ? <ReferencePhoto key={sourceKey} source={source} subject={subject} /> : null}
      <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>Reference only</Text>
      <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{caption}</Text>
      {children}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  guide: { gap: 4, width: '100%' },
  toggle: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 8 },
  detail: { gap: 8 },
  frame: { aspectRatio: 4 / 3, width: '100%', borderRadius: 16, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  loading: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
});
