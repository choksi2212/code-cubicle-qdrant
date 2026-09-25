/**
 * PressableScale — Pressable wrapper that animates a scale transform on
 * press-in / press-out. Used for buttons, list rows, and tab items where
 * a brief "shrunk" state reads as a satisfying haptic-style tap without
 * shipping actual vibration.
 *
 * 80ms in, 120ms out. The asymmetric durations feel snappier than a
 * symmetric 100ms pair, which is what most polished mobile apps ship.
 *
 * Reanimated is used instead of the legacy Animated API so the transform
 * runs on the UI thread and doesn't drop frames during scroll.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'imagebutton' | 'tab' | 'none';
  testID?: string;
}

export function PressableScale({
  children,
  onPress,
  disabled,
  style,
  hitSlop = 8,
  accessibilityLabel,
  accessibilityRole = 'button',
  testID,
}: Props) {
  const scale = useSharedValue(1);

  const onPressIn = useCallback(() => {
    scale.value = withTiming(0.97, { duration: 80 });
  }, [scale]);

  const onPressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 120 });
  }, [scale]);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      testID={testID}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
