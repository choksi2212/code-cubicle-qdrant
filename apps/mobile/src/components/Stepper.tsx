/**
 * Stepper — photo cap stepper (Settings). Five buttons: [-big] [-small]
 * [value] [+small] [+big]. Big = 100, small = 1. Value display uses
 * `typography.numeric` so the digits are tabular and the row doesn't
 * jitter as the number changes.
 *
 * Min / max / step / bigStep props default to sensible values (0 / ∞ /
 * 1 / 100) and `value` is clamped inside `onChange` so consumers don't
 * have to repeat the math.
 *
 * Each button is a 44×44 tap target with a Plus or Minus icon centred,
 * so the row is comfortable on a phone and equally usable in a desktop
 * preview.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, TextStyle, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../theme/tokens';
import { Icon } from './Icon';

interface Props {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  bigStep?: number;
}

const clamp = (n: number, min: number, max: number) => {
  if (Number.isNaN(n)) return min;
  if (max < min) return Math.max(min, n);
  return Math.min(max, Math.max(min, n));
};

export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  bigStep = 100,
}: Props) {
  const update = useCallback(
    (delta: number) => {
      const next = clamp(value + delta, min, max);
      if (next !== value) onChange(next);
    },
    [value, onChange, min, max],
  );

  return (
    <View style={styles.row} accessibilityRole="adjustable">
      <StepBtn
        icon="Minus"
        delta={-bigStep}
        label={`Decrease by ${bigStep}`}
        onPress={update}
        disabled={value - bigStep < min}
      />
      <StepBtn
        icon="Minus"
        delta={-step}
        label={`Decrease by ${step}`}
        onPress={update}
        disabled={value - step < min}
      />
      <View style={styles.valueWrap}>
        <Text style={styles.value}>{value}</Text>
      </View>
      <StepBtn
        icon="Plus"
        delta={step}
        label={`Increase by ${step}`}
        onPress={update}
        disabled={value + step > max}
      />
      <StepBtn
        icon="Plus"
        delta={bigStep}
        label={`Increase by ${bigStep}`}
        onPress={update}
        disabled={value + bigStep > max}
      />
    </View>
  );
}

interface BtnProps {
  icon: 'Plus' | 'Minus';
  delta: number;
  label: string;
  onPress: (delta: number) => void;
  disabled?: boolean;
}

function StepBtn({ icon, delta, label, onPress, disabled }: BtnProps) {
  return (
    <Pressable
      onPress={() => onPress(delta)}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        {
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size="md" color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  btn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  valueWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    ...typography.numeric,
    color: colors.textPrimary,
  } as unknown as TextStyle,
});
