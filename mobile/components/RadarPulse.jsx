import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * RadarPulse — Reusable animated sonar/radar pulse indicator.
 * Provides concentric radiating wave rings around a central beacon.
 * Uses native driver for 60fps GPU-accelerated motion without JS thread overhead.
 */
export default function RadarPulse({
  size = 64,
  color = '#285448',
  icon = 'radio-outline',
  iconSize,
  pulseCount = 3,
  duration = 2800,
  active = true,
  style,
}) {
  const [anims] = useState(() =>
    Array.from({ length: pulseCount }, () => new Animated.Value(0))
  );

  useEffect(() => {
    if (!active) {
      anims.forEach((anim) => anim.setValue(0));
      return;
    }

    const useNative = Platform.OS !== 'web';
    const staggerTime = duration / pulseCount;

    const animations = anims.map((anim, index) =>
      Animated.sequence([
        Animated.delay(index * staggerTime),
        Animated.loop(
          Animated.timing(anim, {
            toValue: 1,
            duration,
            useNativeDriver: useNative,
          })
        ),
      ])
    );

    const composite = Animated.parallel(animations);
    composite.start();

    return () => {
      composite.stop();
      anims.forEach((anim) => anim.stopAnimation());
    };
  }, [active, duration, pulseCount, anims]);

  const effectiveIconSize = iconSize || Math.round(size * 0.42);

  return (
    <View
      style={[
        styles.container,
        { width: size * 2.2, height: size * 2.2 },
        style,
      ]}
      pointerEvents="none"
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel="Radar scanning animation"
    >
      {/* Concentric radiating wave rings */}
      {anims.map((anim, i) => {
        const scale = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.35, 2.2],
        });
        const opacity = anim.interpolate({
          inputRange: [0, 0.25, 0.8, 1],
          outputRange: [0, 0.7, 0.25, 0],
        });

        return (
          <Animated.View
            key={`ring-${i}`}
            style={[
              styles.ring,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: color,
                backgroundColor: color + '15',
                transform: [{ scale }],
                opacity,
              },
            ]}
          />
        );
      })}

      {/* Core beacon / center orb */}
      <View
        style={[
          styles.core,
          {
            width: size * 0.75,
            height: size * 0.75,
            borderRadius: (size * 0.75) / 2,
            backgroundColor: color,
            shadowColor: color,
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={effectiveIconSize}
            color="#FFFFFF"
          />
        ) : (
          <View
            style={[
              styles.dot,
              {
                width: size * 0.28,
                height: size * 0.28,
                borderRadius: (size * 0.28) / 2,
              },
            ]}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  dot: {
    backgroundColor: '#FFFFFF',
  },
});
