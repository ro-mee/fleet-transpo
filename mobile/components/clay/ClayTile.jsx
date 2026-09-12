import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { moldedMaterials } from './molded-materials';

export const ClayTile = memo(function ClayTile({
  icon,
  size = 'md', // 'sm' | 'md' | 'lg' | number (custom dp, e.g. 40)
  variant = 'default', // 'default' | 'primary' | 'secondary' | 'danger' | 'surface'
  color,
  backgroundColor,
  children,
  onPress,
  disabled = false,
  accessibilityRole,
  accessibilityLabel,
  style,
}) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === 'dark';
  const mats = moldedMaterials(isDark);

  const isSmall = size === 'sm';
  const isLarge = size === 'lg';
  const isCustom = typeof size === 'number' && Number.isFinite(size) && size > 0;

  const dimension = isCustom ? size : isSmall ? 38 : isLarge ? 56 : 48;
  const radius = isCustom ? Math.round(size * 0.375) : isSmall ? 14 : isLarge ? 20 : 18;
  const iconSize = isCustom ? Math.round(size * 0.5) : isSmall ? 20 : isLarge ? 28 : 24;

  const resolveVariant = () => {
    if (variant === 'danger') {
      return { bg: colors.errorContainer, fg: colors.onErrorContainer || colors.error };
    }
    if (variant === 'secondary') {
      return { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer || colors.secondary };
    }
    if (variant === 'surface') {
      return { bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)', fg: colors.onSurface };
    }
    if (variant === 'primary') {
      return { bg: colors.primaryContainer, fg: colors.onPrimaryContainer || colors.primary };
    }
    return { bg: colors.surfaceContainerLow, fg: colors.primary };
  };

  const vCols = resolveVariant();
  const bg = backgroundColor || vCols.bg;
  const iconColor = color || vCols.fg;

  const shadow = {
    shadowColor: colors.shadow,
    shadowOpacity: isDark ? 0.35 : 0.17,
  };

  const tileStyle = [
    styles.base,
    shadow,
    mats.clayTile,
    {
      width: dimension,
      height: dimension,
      borderRadius: radius,
      backgroundColor: bg,
    },
    style,
  ];

  const renderContent = () => {
    if (children) return children;
    if (typeof icon === 'string') {
      return <Ionicons name={icon} size={iconSize} color={iconColor} />;
    }
    return icon;
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={accessibilityRole || 'button'}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          tileStyle,
          pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        {renderContent()}
      </Pressable>
    );
  }

  return <View style={tileStyle}>{renderContent()}</View>;
});

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
});

