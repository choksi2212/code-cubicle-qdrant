/**
 * ScreenScaffold — frosted-glass header bar with title, back button,
 * and optional right action. Renders above a flexible content area.
 *
 * Used by every top-level route that wants a consistent app-shell
 * header (Library, Map, Settings). Full-screen routes (Capture,
 * SyncReport, Onboarding) skip this and render their own custom
 * layout.
 *
 * Visual rules:
 *   - Background: `colors.glass` (translucent dark) over the page bg
 *     so it reads as "elevated above content" when scrolled
 *   - Top border: 1px `colors.glassBorder` (subtle)
 *   - Title: `typography.h2`, primary text
 *   - Back: 36px tap target, ChevronLeft icon, hitSlop 12
 *   - Right action: a single icon Pressable (e.g. gear) — same 36px
 *     tap target as back
 *
 * SafeAreaView at the top is from `react-native-safe-area-context`,
 * so the header stays inside the notch / status-bar area on iOS and
 * respects display cutouts on Android.
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  spacing,
  typography,
} from '../theme/tokens';
import { Icon, IconName } from './Icon';

interface RightAction {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel?: string;
}

interface Props {
  title: string;
  subtitle?: string | undefined;
  onBack?: () => void;
  rightAction?: RightAction;
  children: React.ReactNode;
}

export function ScreenScaffold({
  title,
  subtitle,
  onBack,
  rightAction,
  children,
}: Props) {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Icon name="ChevronLeft" size="lg" color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.iconBtnPlaceholder} />
        )}
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightAction ? (
          <Pressable
            onPress={rightAction.onPress}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={rightAction.accessibilityLabel ?? 'Action'}
          >
            <Icon
              name={rightAction.icon}
              size="lg"
              color={colors.textPrimary}
            />
          </Pressable>
        ) : (
          <View style={styles.iconBtnPlaceholder} />
        )}
      </View>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.glass,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  iconBtnPlaceholder: {
    width: 36,
    height: 36,
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing[2],
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.small,
    color: colors.textTertiary,
    marginTop: 2,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
});
