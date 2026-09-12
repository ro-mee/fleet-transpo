import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';

export const ClaySection = memo(function ClaySection({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
  style,
  headerStyle,
}) {
  const { colors, type } = useTheme();

  return (
    <View style={[styles.section, style]}>
      {(title || actionLabel) && (
        <View style={[styles.headerRow, headerStyle]}>
          <View style={styles.titleCol}>
            {title && <Text style={[type.titleLg, styles.title]}>{title}</Text>}
            {subtitle && (
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                {subtitle}
              </Text>
            )}
          </View>
          {actionLabel && onAction && (
            <Pressable
              onPress={onAction}
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              style={({ pressed }) => [styles.actionLink, pressed && styles.actionPressed]}
            >
              <Text style={[type.labelLg, { color: colors.primary }]}>{actionLabel}</Text>
              <Ionicons name="chevron-forward" color={colors.primary} size={16} />
            </Pressable>
          )}
        </View>
      )}
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    gap: 12,
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  titleCol: {
    flex: 1,
    minWidth: 160,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold',
  },
  actionLink: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionPressed: {
    opacity: 0.75,
  },
});

