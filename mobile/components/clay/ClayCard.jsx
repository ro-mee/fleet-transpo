import { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../lib/theme-context';
import { useSettings } from '../../lib/settings-context';
import { moldedMaterials } from './molded-materials';

export const ClayCard = memo(function ClayCard({
  children,
  style,
  variant = 'standard', // 'standard' | 'compact' | 'hero' | 'accent' | 'flat'
  onPress,
  disabled = false,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  showSheen = true,
  contentStyle,
}) {
  const { colors, scheme } = useTheme();
  const { settings } = useSettings();
  const isDark = scheme === 'dark';
  const mats = moldedMaterials(isDark);

  const isCompact = variant === 'compact';
  const isHero = variant === 'hero';
  const isAccent = variant === 'accent';
  const isFlat = variant === 'flat';

  const shadeStyle = isCompact ? mats.compactShade : mats.clayShade;
  const radius = isHero ? 28 : isCompact ? 20 : isAccent ? 20 : 24;

  const bg = isAccent
    ? colors.primaryContainer
    : colors.surfaceContainerLow;

  const cardStyle = [
    styles.base,
    {
      borderRadius: radius,
      backgroundColor: bg,
      shadowColor: colors.shadow,
    },
    !isFlat && shadeStyle,
    style,
  ];

  const sheen = showSheen && !settings?.highContrast && Platform.OS !== 'android' ? (
    <LinearGradient
      pointerEvents="none"
      colors={
        isDark
          ? ['rgba(255,253,252,0.07)', 'rgba(255,253,252,0)']
          : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[
        styles.sheen,
        {
          borderTopLeftRadius: radius - 2,
          borderTopRightRadius: radius - 2,
        },
      ]}
    />
  ) : null;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={accessibilityRole || 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, ...accessibilityState }}
        style={({ pressed }) => [
          cardStyle,
          pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        {sheen}
        {contentStyle ? <View style={contentStyle}>{children}</View> : children}
      </Pressable>
    );
  }

  return (
    <View style={cardStyle}>
      {sheen}
      {contentStyle ? <View style={contentStyle}>{children}</View> : children}
    </View>
  );
});

const styles = StyleSheet.create({
  base: {
    padding: 14,
    gap: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 30,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.94,
  },
  disabled: {
    opacity: 0.6,
  },
});

