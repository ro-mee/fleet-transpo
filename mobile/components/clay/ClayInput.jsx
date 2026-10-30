import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts } from '../../lib/theme';
import { moldedMaterials } from './molded-materials';

export const ClayInput = forwardRef(function ClayInput(
  {
    label,
    error,
    helperText,
    icon,
    rightIcon,
    onRightIconPress,
    rightIconAccessibilityLabel,
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
    : colors.outlineVariant;

  const moldedInputStyle = {
    ...mats.clayInput,
    borderWidth: hasError || isFocused ? 1.5 : 1,
    borderTopWidth: hasError || isFocused ? 1.5 : 1,
    borderBottomWidth: hasError || isFocused ? 1.5 : 1,
    borderColor,
    borderTopColor: borderColor,
    borderBottomColor: borderColor,
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
          accessibilityLabel={label}
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
            type.bodyMd,
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
            accessibilityLabel={rightIconAccessibilityLabel || (secureTextEntry === true ? 'Show password' : secureTextEntry === false ? 'Hide password' : label ? `${label} action` : 'Input action')}
            accessibilityState={{ disabled: !onRightIconPress }}
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
    fontFamily: fonts.bodySemiBold,
    marginBottom: 2,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
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
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
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

