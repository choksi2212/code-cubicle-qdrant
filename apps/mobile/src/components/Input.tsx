/**
 * Input — single text-input primitive. Used by Settings (Server URL)
 * and any future form. The animated focus border is the only motion:
 * an underline shifts colour from `colors.border` to `colors.accent`
 * via Reanimated the moment the input gains focus, and back when it
 * loses it.
 *
 * Visuals:
 *   - elevated surface background (`colors.surfaceElevated`)
 *   - 1px border, 12px radius, 16px horizontal padding
 *   - 14px font, white-on-dark text
 *   - optional leading/trailing icons (Lucide via the Icon component)
 *   - inline error message in `colors.danger` beneath the field
 */

import React, { useCallback, useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../theme/tokens';
import { Icon, IconName } from './Icon';

interface Props extends Omit<TextInputProps, 'style'> {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  error?: string;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  secureTextEntry?: boolean;
  multiline?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  leadingIcon,
  trailingIcon,
  secureTextEntry,
  multiline,
  style,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const focusProgress = useSharedValue(0);

  const onFocus = useCallback(() => {
    setFocused(true);
    focusProgress.value = withTiming(1, { duration: 180 });
  }, [focusProgress]);

  const onBlur = useCallback(() => {
    setFocused(false);
    focusProgress.value = withTiming(0, { duration: 180 });
  }, [focusProgress]);

  const underlineStyle = useAnimatedStyle(() => ({
    opacity: focusProgress.value,
    transform: [{ scaleX: focusProgress.value }],
  }));

  const borderColor = error
    ? colors.danger
    : focused
    ? colors.accent
    : colors.border;

  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.field, { borderColor, backgroundColor: colors.surfaceElevated }]}>
        {leadingIcon ? (
          <Icon
            name={leadingIcon}
            size="sm"
            color={focused ? colors.accent : colors.textTertiary}
          />
        ) : null}
        <TextInput
          {...rest}
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.textDisabled}
          secureTextEntry={secureTextEntry}
          multiline={multiline}
          style={[
            styles.input,
            multiline ? styles.inputMultiline : null,
          ]}
          underlineColorAndroid="transparent"
        />
        {trailingIcon ? (
          <Icon
            name={trailingIcon}
            size="sm"
            color={colors.textTertiary}
          />
        ) : null}
        <Animated.View
          pointerEvents="none"
          style={[styles.underline, underlineStyle]}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2],
  },
  label: {
    color: colors.textSecondary,
    ...typography.smallStrong,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    padding: 0,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  underline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: colors.accent,
    transformOrigin: 'left',
  },
  error: {
    color: colors.danger,
    ...typography.small,
  },
});
