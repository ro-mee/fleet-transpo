import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { moldedMaterials } from './molded-materials';

export const ClayButton = memo(function ClayButton({
  label,
  onPress,
  variant = 'primary', // 'primary' | 'secondary' | 'tonal' | 'danger' | 'outline'
  size = 'md', // 'sm' | 'md' | 'lg'
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'left',
  style,
  textStyle,
  accessibilityRole = 'button',
  accessibilityLabel,
}) {
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === 'dark';
  const mats = moldedMaterials(isDark);
  const raised = mats.clayButton;
  const isDisabled = disabled || loading;

  const isOutline = variant === 'outline';
  const isSecondary = variant === 'secondary';
  const isTonal = variant === 'tonal';
  const isDanger = variant === 'danger';

  const bgColor = isOutline
    ? 'transparent'
    : isDanger
    ? colors.errorContainer
    : isSecondary
    ? colors.secondaryContainer
    : isTonal
    ? colors.surfaceContainerHigh
    : colors.primary;

  const textColor = isOutline
    ? colors.primary
    : isDanger
    ? colors.onErrorContainer
    : isSecondary
    ? colors.onSecondaryContainer
    : isTonal
    ? colors.onSurface
    : colors.onPrimary;

  const minHeight = size === 'sm' ? 40 : size === 'lg' ? 54 : 48;
  const paddingHorizontal = size === 'sm' ? 12 : size === 'lg' ? 20 : 16;
  const iconSize = size === 'sm' ? 17 : size === 'lg' ? 22 : 19;

  const renderIcon = () => {
    if (!icon) return null;
    if (typeof icon === 'string') {
      return <Ionicons name={icon} size={iconSize} color={textColor} />;
    }
    return icon;
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || (typeof label === 'string' ? label : undefined)}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight,
          paddingHorizontal,
          backgroundColor: bgColor,
          shadowColor: colors.shadow,
        },
        !isOutline ? raised : styles.outlineBorder,
        isOutline && { borderColor: colors.outlineVariant },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <View style={styles.contentRow}>
          {iconPosition === 'left' && renderIcon()}
          {label ? (
            <Text
              style={[
                type.labelLg,
                styles.label,
                { color: textColor },
                size === 'sm' && styles.labelSmall,
                textStyle,
              ]}
            >
              {label}
            </Text>
          ) : null}
          {iconPosition === 'right' && renderIcon()}
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    letterSpacing: 0.3,
  },
  labelSmall: {
    fontSize: 13,
  },
  outlineBorder: {
    borderWidth: 1,
    elevation: 0,
    shadowOpacity: 0,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.94,
  },
  disabled: {
    opacity: 0.55,
  },
});

