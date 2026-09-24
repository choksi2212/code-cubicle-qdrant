/**
 * EmptyState — full-screen "nothing here yet" panel used by Library,
 * Map, and Search when their respective data sets are empty.
 *
 * Visuals:
 *   - Centred icon inside an 80px circular `colors.surfaceElevated`
 *     well, so the icon reads as the focal point
 *   - `typography.h2` title and (optional) `typography.body` subtitle
 *     below
 *   - Optional CTA button rendered with our standard Button component
 *     in secondary variant (so the empty state stays visually quiet)
 *
 * The component doesn't dictate layout — it just centres itself and
 * lets the parent decide whether to wrap it in a ScrollView. The
 * default flex behaviour is to fill its parent (it uses `flex: 1`
 * via the style prop override consumers can pass).
 */

import React from 'react';
import { StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../theme/tokens';
import { Button } from './Button';
import { Icon, IconName } from './Icon';

interface Props {
  icon: IconName;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  style,
}: Props) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconWell}>
        <Icon name={icon} size="xl" color={colors.accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button
            label={actionLabel}
            onPress={onAction}
            variant="secondary"
            fullWidth={false}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[8],
    gap: spacing[3],
  },
  iconWell: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  action: {
    marginTop: spacing[4],
  },
});
