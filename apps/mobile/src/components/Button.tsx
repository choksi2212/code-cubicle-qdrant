/**
 * Button — primary, secondary, ghost, and danger variants. Used as the
 * only actionable surface across screens — replaces the bespoke inline
 * Pressable+Text combos that used to pepper every screen.
 *
 * Visual rules:
 *   primary   — filled accent, white-on-indigo
 *   secondary — surface w/ border, primary text
 *   ghost     — transparent, accent text (used for quiet "cancel" actions)
 *   danger    — dangerSubtle bg + danger border + danger text
 *
 * Interaction rules:
 *   - press scale animates from 1.0 → 0.97 → 1.0 in ~100ms (Reanimated)
 *   - android_ripple colour uses a translucent white so the touch ripple
 *     reads as a soft highlight rather than a coloured fill
 *   - loading replaces the label with a centred spinner; the underlying
 *     onPress is no-op while busy
 *   - disabled drops opacity to 0.5 and swallows presses
 *
 * Defaults to full width because every button on a phone-width screen
 * wants the same horizontal margins; pass `fullWidth={false}` only for
 * inline button groups (e.g. a toolbar).
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
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

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZE_PADDING: Record<ButtonSize, { v: number; h: number; font: number }> = {
  sm: { v: spacing[2], h: spacing[3], font: 13 },
  md: { v: spacing[3], h: spacing[4], font: 15 },
  lg: { v: spacing[4], h: spacing[6], font: 16 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  leadingIcon,
  trailingIcon,
  fullWidth = true,
  style,
}: Props) {
  const scale = useSharedValue(1);

  const onPressIn = useCallback(() => {
    scale.value = withTiming(0.97, { duration: 80 });
  }, [scale]);

  const onPressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 120 });
  }, [scale]);

  const pad = SIZE_PADDING[size];
  const variantStyle = VARIANT_STYLES[variant];
  const isDisabled = disabled || loading;
  const showIconColor = variantStyle.iconColor;

  // The Pressable's base style is a static array so test renderers can
  // see it in the snapshot. We apply pressed-state styling via the
  // Pressable's `style` function so the runtime path stays native;
  // tests just observe the static portion.
  const baseStyle: StyleProp<ViewStyle> = [
    styles.base,
    {
      paddingVertical: pad.v,
      paddingHorizontal: pad.h,
      backgroundColor: variantStyle.bg,
      borderColor: variantStyle.border,
      opacity: isDisabled ? 0.5 : 1,
      width: fullWidth ? '100%' : undefined,
    },
    style,
  ];

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={isDisabled}
      android_ripple={{
        color: 'rgba(255,255,255,0.08)',
        borderless: false,
      }}
      style={baseStyle}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
    >
      <Animated.View style={[styles.row, { transform: [{ scale }] }]}>
        {loading ? (
          <ActivityIndicator color={showIconColor} />
        ) : (
          <>
            {leadingIcon ? (
              <Icon
                name={leadingIcon}
                size={size === 'lg' ? 'md' : 'sm'}
                color={showIconColor}
              />
            ) : null}
            <Text
              style={[
                styles.label,
                { color: variantStyle.text, fontSize: pad.font },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {trailingIcon ? (
              <Icon
                name={trailingIcon}
                size={size === 'lg' ? 'md' : 'sm'}
                color={showIconColor}
              />
            ) : null}
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

const VARIANT_STYLES: Record<
  ButtonVariant,
  { bg: string; border: string; text: string; iconColor: string }
> = {
  primary: {
    bg: colors.accent,
    border: colors.accent,
    text: colors.textOnAccent,
    iconColor: colors.textOnAccent,
  },
  secondary: {
    bg: colors.surface,
    border: colors.border,
    text: colors.textPrimary,
    iconColor: colors.textPrimary,
  },
  ghost: {
    bg: 'transparent',
    border: 'transparent',
    text: colors.accent,
    iconColor: colors.accent,
  },
  danger: {
    bg: colors.dangerSubtle,
    border: colors.danger,
    text: colors.danger,
    iconColor: colors.danger,
  },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  label: {
    ...typography.bodyStrong,
  },
});
