/**
 * Avatar — round monogram avatar. Renders the first letter of the
 * provided label centred inside a circular surface, using the accent
 * colour for the letter so the avatar pops against the page background.
 *
 * Used in Settings → Account to represent the device's prefix — keeps
 * the row visually rich without leaning on an image we don't actually
 * have (a real device has no avatar photo).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  typography,
} from '../theme/tokens';

type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<AvatarSize, { box: number; font: number }> = {
  sm: { box: 32, font: 14 },
  md: { box: 44, font: 18 },
  lg: { box: 64, font: 24 },
};

interface Props {
  label: string;
  size?: AvatarSize;
}

export function Avatar({ label, size = 'md' }: Props) {
  const { box, font } = SIZE_PX[size];
  const monogram = (label?.trim().charAt(0) ?? '·').toUpperCase();

  return (
    <View
      style={[
        styles.box,
        {
          width: box,
          height: box,
          borderRadius: radius.full,
        },
      ]}
    >
      <Text
        style={[styles.letter, { fontSize: font }]}
        accessibilityLabel={`Avatar for ${label}`}
      >
        {monogram}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  letter: {
    color: colors.accent,
    ...typography.h3,
  },
});
