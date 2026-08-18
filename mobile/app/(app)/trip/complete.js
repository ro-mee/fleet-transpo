import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../lib/theme-context';
import { fonts } from '../../../lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LottieView from 'lottie-react-native';

export default function TripCompleteScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3, // Lower friction = more bounce
      tension: 60, // Higher tension = faster bounce
      useNativeDriver: true,
    }).start();
  }, []);
  
  // time string like "8:37 AM"
  const timeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  
  const { pickup, destination, duration, distance, startOdo, endOdo } = useLocalSearchParams();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.content, { paddingBottom: insets.bottom + 16, paddingTop: insets.top + 32 }]}>
        
        {/* Success Header */}
        <View style={styles.header}>
          <Animated.View style={[styles.iconCircle, { backgroundColor: colors.secondaryContainer + '33', transform: [{ scale: scaleAnim }] }]}> 
            <LottieView
              source={require('../../../assets/Green tick.json')}
              autoPlay
              loop={false}
              style={styles.successAnimation}
            />
          </Animated.View>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.title, { color: colors.onSurface }]}>Trip Completed</Text>
            <Text style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>Great job. Your trip has been recorded.</Text>
            <Text style={[styles.timeText, { color: colors.outline }]}>{timeStr}</Text>
          </View>
        </View>

        {/* Summary Card */}
        <View style={[styles.card, { backgroundColor: colors.surfaceContainer }]}>
          <View style={styles.cardRow}>
            <Ionicons name="locate" size={20} color={colors.outline} style={{ marginTop: 2 }} />
            <View style={styles.cardCol}>
              <Text style={[styles.label, { color: colors.outline }]}>PICKUP</Text>
              <Text style={[styles.value, { color: colors.onSurface }]}>{pickup || "Hotel Seda"}</Text>
            </View>
          </View>

          <View style={[styles.cardRow, { borderTopWidth: 1, borderTopColor: colors.outlineVariant + '4D', paddingTop: 16 }]}>
            <Ionicons name="location" size={20} color={colors.primary} style={{ marginTop: 2 }} />
            <View style={styles.cardCol}>
              <Text style={[styles.label, { color: colors.outline }]}>DESTINATION</Text>
              <Text style={[styles.value, { color: colors.onSurface }]}>{destination || "NAIA Terminal 3"}</Text>
            </View>
          </View>

          <View style={[styles.gridRow, { borderTopWidth: 1, borderTopColor: colors.outlineVariant + '4D', paddingTop: 16 }]}>
            <View style={styles.cardCol}>
              <Text style={[styles.label, { color: colors.outline }]}>DURATION</Text>
              <Text style={[styles.value, { color: colors.onSurface }]}>{duration || "42 min"}</Text>
            </View>
            <View style={styles.cardCol}>
              <Text style={[styles.label, { color: colors.outline }]}>DISTANCE</Text>
              <Text style={[styles.value, { color: colors.onSurface }]}>{distance || "11.4 km"}</Text>
            </View>
          </View>

          <View style={[styles.cardCol, { borderTopWidth: 1, borderTopColor: colors.outlineVariant + '4D', paddingTop: 16 }]}>
            <Text style={[styles.label, { color: colors.outline }]}>ODOMETER RANGE</Text>
            <Text style={[styles.odoValue, { color: colors.onSurface }]}>
              {startOdo || "45,820"} <Text style={{ color: colors.outline }}>→</Text> {endOdo || "45,831"} km
            </Text>
          </View>
        </View>

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* Actions */}
        <View style={styles.actionsGroup}>
          <View style={styles.gridRow}>
            <Pressable style={({pressed}) => [styles.secondaryBtn, { borderColor: colors.outline, backgroundColor: pressed ? colors.surfaceVariant : 'transparent' }]}>
              <Ionicons name="document-text-outline" size={18} color={colors.onSurface} />
              <Text style={[styles.secondaryBtnText, { color: colors.onSurface }]}>Add Note</Text>
            </Pressable>
            <Pressable style={({pressed}) => [styles.secondaryBtn, { borderColor: colors.outline, backgroundColor: pressed ? colors.surfaceVariant : 'transparent' }]}>
              <Ionicons name="warning-outline" size={18} color={colors.onSurface} />
              <Text style={[styles.secondaryBtnText, { color: colors.onSurface }]}>Report Issue</Text>
            </Pressable>
          </View>

          <Pressable 
            style={({pressed}) => [styles.doneBtn, { backgroundColor: colors.secondaryContainer, opacity: pressed ? 0.9 : 1 }]}
            onPress={() => router.replace('/(app)/(tabs)/map')}
          >
            <Text style={[styles.doneBtnText, { color: colors.onSecondaryContainer }]}>DONE</Text>
          </Pressable>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconCircle: {
    width: 144,
    height: 144,
    borderRadius: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successAnimation: {
    width: 132,
    height: 132,
  },
  headerTextGroup: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: fonts.headlineLgMobile,
    fontSize: 28,
    fontWeight: '600',
  },
  subtitle: {
    fontFamily: fonts.bodyLg,
    fontSize: 16,
  },
  timeText: {
    fontFamily: fonts.labelMd,
    fontSize: 12,
  },
  card: {
    borderRadius: 16,
    padding: 24,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  cardCol: {
    gap: 4,
    flex: 1,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  label: {
    fontFamily: fonts.labelSm,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: fonts.bodyLg,
    fontSize: 16,
    fontWeight: '500',
  },
  odoValue: {
    fontFamily: fonts.labelMd,
    fontSize: 14,
  },
  actionsGroup: {
    gap: 16,
  },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtnText: {
    fontFamily: fonts.labelMd,
    fontSize: 12,
  },
  doneBtn: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  doneBtnText: {
    fontFamily: fonts.titleLg,
    fontSize: 22,
    fontWeight: '700',
  }
});
