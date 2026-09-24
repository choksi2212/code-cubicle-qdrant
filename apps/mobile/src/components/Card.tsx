/**
 * Card — single visual primitive for "a chunk of UI sitting on a darker
 * background". Wraps content in `colors.surface` with a 1px `colors.border`
 * outline, `radius.lg` corners, and a small `elevation.sm` shadow so
 * cards read as lifted above the page background.
 *
 * Everywhere the old screens used
 *   `<View style={{ backgroundColor: '#1A1F26', borderRadius: 12 }}>`
 * they should now use `<Card>`. Keeps spacing/color consistent across
 * the redesign and stops hex codes from leaking back into screens.
 */

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import {
  colors,
  elevation,
  radius,
  spacing,
} from '../theme/tokens';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Removes the border + elevation for nested cards inside a section. */
  inset?: boolean;
  /** Pad-less content edge-to-edge (PhotoGrid usage). */
  flush?: boolean;
}

export function Card({ children, style, inset, flush }: Props) {
  return (
    <View
      style={[
        styles.base,
        !inset && styles.outlined,
        !inset && elevation.sm,
        flush ? styles.flush : styles.padded,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  outlined: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  padded: {
    padding: spacing[4],
  },
  flush: {
    padding: 0,
  },
});
