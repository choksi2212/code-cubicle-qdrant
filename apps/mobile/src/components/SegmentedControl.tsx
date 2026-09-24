/**
 * SegmentedControl — iOS-style segmented control with a sliding
 * highlight. Replaces the old chip row used by Settings → Sync
 * interval picker.
 *
 * The active segment sits inside a `colors.surfaceElevated` pill that
 * slides horizontally between segments; the underlying track is
 * `colors.bgElevated`. Inactive labels are `colors.textTertiary`, the
 * active one is `colors.textPrimary` with an optional icon.
 *
 * Reanimated handles the sliding animation with a spring that mirrors
 * iOS's native feel — `motion.easing.spring` from our design tokens.
 * `onLayout` per segment records the x-offset / width so the highlight
 * tracks each segment's position regardless of label length.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  colors,
  motion,
  radius,
  spacing,
  typography,
} from '../theme/tokens';
import { Icon, IconName } from './Icon';

export interface Segment {
  value: string;
  label: string;
  icon?: IconName;
}

interface Props {
  segments: Segment[];
  value: string;
  onChange: (value: string) => void;
}

interface SegmentLayout {
  x: number;
  width: number;
}

export function SegmentedControl({ segments, value, onChange }: Props) {
  const [layouts, setLayouts] = useState<Record<string, SegmentLayout>>({});
  const activeIndex = Math.max(
    0,
    segments.findIndex((s) => s.value === value),
  );
  const activeKey = segments[activeIndex]?.value;
  const active = activeKey ? layouts[activeKey] : undefined;

  const offsetX = useSharedValue(0);
  const widthSv = useSharedValue(0);
  const initialised = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (!initialised.current) {
      // First paint — snap without animation so the highlight doesn't
      // slide in from the origin every mount.
      offsetX.value = active.x;
      widthSv.value = active.width;
      initialised.current = true;
      return;
    }
    offsetX.value = withSpring(active.x, motion.easing.spring);
    widthSv.value = withSpring(active.width, motion.easing.spring);
  }, [active, offsetX, widthSv]);

  const onLayoutSegment = useCallback(
    (segmentValue: string) => (e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      setLayouts((prev) =>
        prev[segmentValue]?.x === x && prev[segmentValue]?.width === width
          ? prev
          : { ...prev, [segmentValue]: { x, width } },
      );
    },
    [],
  );

  const highlightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }],
    width: widthSv.value,
  }));

  return (
    <View style={styles.track} accessibilityRole="tablist">
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.highlight, highlightStyle]}
        />
      ) : null}
      {segments.map((segment) => {
        const isActive = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            onLayout={onLayoutSegment(segment.value)}
            onPress={() => onChange(segment.value)}
            style={styles.segment}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            {segment.icon ? (
              <Icon
                name={segment.icon}
                size="sm"
                color={isActive ? colors.textPrimary : colors.textTertiary}
              />
            ) : null}
            <Text
              style={[
                styles.label,
                { color: isActive ? colors.textPrimary : colors.textTertiary },
              ]}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: spacing[1],
    gap: 2,
  },
  highlight: {
    position: 'absolute',
    top: spacing[1],
    bottom: spacing[1],
    left: 0,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.sm,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    gap: spacing[2],
    borderRadius: radius.sm,
  },
  label: {
    ...typography.smallStrong,
    textAlign: 'center',
  },
});
