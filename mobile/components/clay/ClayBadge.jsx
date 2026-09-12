import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { statusColorForTone } from '../../lib/theme';
import { moldedMaterials } from './molded-materials';

export const ClayBadge = memo(function ClayBadge({
  label,
  text,
  tone = 'neutral', // 'success' | 'danger' | 'warning' | 'info' | 'primary' | 'neutral'
  variant,
  statusDot = false,
  dot = false,
  dotColor,
  icon,
  size = 'md', // 'sm' | 'md'
  active = true,
  onPress,
  style,
  textStyle,
  accessibilityRole,
  accessibilityLabel,
}) {
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === 'dark';
  const mats = moldedMaterials(isDark);
  const edges = mats.clayPill;

  const displayLabel = label ?? text;
  const rawTone = tone !== 'neutral' ? tone : (variant || 'neutral');
  const hasDot = statusDot || dot;
  const isSmall = size === 'sm';

  const getColors = () => {
    if (rawTone === 'primary') {
      return { bg: colors.primary, fg: colors.onPrimary };
    }
    const cleanTone = rawTone === 'error' ? 'danger' : rawTone === 'secondary' ? 'info' : rawTone;
    return statusColorForTone(colors, cleanTone);
  };

  const sc = getColors();
  const bg = active ? sc.bg : colors.surfaceContainer;
  const fg = active ? sc.fg : colors.onSurfaceVariant;

  const pillStyle = [
    styles.base,
    edges,
    {
      backgroundColor: bg,
      paddingHorizontal: isSmall ? 8 : 12,
      paddingVertical: isSmall ? 4 : 6,
      borderRadius: isSmall ? 14 : 16,
    },
    style,
  ];

  const content = (
    <View style={styles.contentRow}>
      {hasDot && (
        <View style={[styles.dot, { backgroundColor: dotColor || fg }]} />
      )}
      {icon && typeof icon === 'string' ? (
        <Ionicons name={icon} size={isSmall ? 12 : 14} color={fg} />
      ) : (
        icon
      )}
      {displayLabel ? (
        <Text
          style={[
            type.caption,
            styles.label,
            { color: fg },
            isSmall && styles.labelSmall,
            textStyle,
          ]}
          numberOfLines={1}
        >
          {displayLabel}
        </Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole={accessibilityRole || 'button'}
        accessibilityLabel={accessibilityLabel || (typeof label === 'string' ? label : undefined)}
        style={({ pressed }) => [
          pillStyle,
          pressed && styles.pressed,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={pillStyle}>{content}</View>;
});

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    letterSpacing: 0.3,
  },
  labelSmall: {
    fontSize: 11,
    lineHeight: 14,
  },
  pressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.85,
  },
});

