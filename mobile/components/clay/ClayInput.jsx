import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { moldedMaterials } from './molded-materials';

export const ClayInput = forwardRef(function ClayInput(
  {
    label,
    error,
    helperText,
    icon,
    rightIcon,
    onRightIconPress,
    value,
    onChangeText,
    placeholder,
    secureTextEntry,
    multiline = false,
    numberOfLines = 1,
    keyboardType,
    autoCapitalize = 'none',
    editable = true,
    style,
    inputStyle,
    containerStyle,
    ...rest
  },
  ref
) {
  const { colors, type, scheme } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const isDark = scheme === 'dark';
  const mats = moldedMaterials(isDark);

  const hasError = Boolean(error);
  const borderColor = hasError
    ? colors.error
    : isFocused
    ? colors.primary
    : isDark
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.08)';

  const moldedInputStyle = mats.supported
    ? isFocused
      ? {
          borderWidth: 1.5,
          borderColor: colors.primary,
          borderTopWidth: 1.5,
          borderBottomWidth: 1.5,
          borderTopColor: colors.primary,
          borderBottomColor: colors.primary,
          boxShadow: `inset 1px 2px 3px ${isDark ? 'rgba(0,0,0,0.30)' : 'rgba(83,74,53,0.08)'}`,
        }
      : hasError
      ? {
          borderWidth: 1.5,
          borderColor: colors.error,
          borderTopWidth: 1.5,
          borderBottomWidth: 1.5,
          borderTopColor: colors.error,
          borderBottomColor: colors.error,
          boxShadow: `inset 1px 2px 3px ${isDark ? 'rgba(0,0,0,0.30)' : 'rgba(83,74,53,0.08)'}`,
        }
      : mats.clayInput
    : {
        borderWidth: 1,
        borderTopWidth: 1.5,
        borderBottomWidth: 2,
        borderColor,
        borderTopColor: isFocused
          ? colors.primary
          : isDark
          ? 'rgba(255,255,255,0.14)'
          : '#FFFFFF88',
        borderBottomColor: isFocused
          ? colors.primary
          : isDark
          ? 'rgba(0,0,0,0.40)'
          : '#00000018',
      };

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {label && (
        <Text style={[type.labelLg, styles.label, { color: hasError ? colors.error : colors.onSurfaceVariant }]}>
          {label}
        </Text>
      )}

      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.surfaceContainerLow,
          },
          moldedInputStyle,
          multiline && styles.multilineContainer,
          !editable && styles.disabled,
          style,
        ]}
      >
        {icon && (
          <View style={styles.iconBox}>
            <Ionicons
              name={icon}
              size={20}
              color={hasError ? colors.error : isFocused ? colors.primary : colors.onSurfaceVariant}
            />
          </View>
        )}

        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.outline}
          secureTextEntry={secureTextEntry}
          multiline={multiline}
          numberOfLines={numberOfLines}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          editable={editable}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={[
            styles.input,
            { color: colors.onSurface },
            multiline && styles.multilineInput,
            inputStyle,
          ]}
          {...rest}
        />

        {rightIcon && (
          <Pressable
            onPress={onRightIconPress}
            disabled={!onRightIconPress}
            style={styles.rightIconBox}
            accessibilityRole={onRightIconPress ? 'button' : undefined}
          >
            <Ionicons
              name={rightIcon}
              size={20}
              color={hasError ? colors.error : isFocused ? colors.primary : colors.onSurfaceVariant}
            />
          </Pressable>
        )}
      </View>

      {hasError ? (
        <Text style={[type.caption, styles.errorText, { color: colors.error }]}>
          {error}
        </Text>
      ) : helperText ? (
        <Text style={[type.caption, styles.helperText, { color: colors.onSurfaceVariant }]}>
          {helperText}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    gap: 6,
    width: '100%',
  },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    marginBottom: 2,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  multilineContainer: {
    minHeight: 88,
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  iconBox: {
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightIconBox: {
    marginLeft: 8,
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-Regular',
    paddingVertical: 8,
  },
  multilineInput: {
    textAlignVertical: 'top',
    minHeight: 68,
  },
  errorText: {
    marginTop: 2,
    marginLeft: 4,
  },
  helperText: {
    marginTop: 2,
    marginLeft: 4,
  },
  disabled: {
    opacity: 0.6,
  },
});

