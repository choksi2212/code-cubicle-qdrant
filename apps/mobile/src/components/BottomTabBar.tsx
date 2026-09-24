/**
 * BottomTabBar — iOS-style bottom tab bar with three regular tabs and
 * a centred floating action button (FAB) that visually sits above the
 * bar. Replaces the in-screen "Search | Album | Map" chip strip from
 * SearchScreen and the old Capture/Sync action row from App.tsx.
 *
 * Tab slots:
 *   Library  (Image icon)   — search + grid browse
 *   Map      (MapPin icon)  — geo-tagged browse
 *   Settings (Sliders icon) — gear
 *
 * FAB:
 *   Sits at the bar's centre. Renders `fabIcon` (default Camera) inside
 *   a 56px circular accent surface that protrudes ~14px above the bar
 *   so it reads as a distinct primary action. Tapping it calls
 *   `onFabPress`.
 *
 * Visual rules:
 *   - Background: `colors.glass` w/ top border `colors.glassBorder` so
 *     the bar reads as a frosted overlay above the content
 *   - Active tab: `colors.accent` icon + label
 *   - Inactive tab: `colors.textTertiary` icon + label
 *   - Tap-target per tab: 56px tall (iOS HIG-compatible)
 *
 * Haptics are intentionally NOT invoked. The on-press scale animation
 * on the icon Pressable is enough tactile feedback for a tab switch;
 * the system already plays a click on real iOS tab bars, and our
 * Android tab bar (without Vibration) doesn't have a clean cross-
 * platform path that wouldn't surprise users.
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../theme/tokens';
import { Icon, IconName } from './Icon';

export interface TabSpec {
  key: string;
  label: string;
  icon: IconName;
}

interface Props {
  tabs: TabSpec[];
  active: string;
  onChange: (key: string) => void;
  onFabPress?: () => void;
  fabIcon?: IconName;
}

export function BottomTabBar({
  tabs,
  active,
  onChange,
  onFabPress,
  fabIcon = 'Camera',
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, spacing[2]) },
      ]}
    >
      <View style={styles.row}>
        {tabs.slice(0, 2).map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            active={tab.key === active}
            onPress={() => onChange(tab.key)}
          />
        ))}

        {onFabPress ? (
          <Pressable
            onPress={onFabPress}
            style={({ pressed }) => [
              styles.fab,
              { transform: [{ scale: pressed ? 0.94 : 1 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Capture"
            hitSlop={8}
          >
            <Icon name={fabIcon} size="lg" color={colors.textOnAccent} />
          </Pressable>
        ) : (
          <View style={styles.fabSpacer} />
        )}

        {tabs.slice(2).map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            active={tab.key === active}
            onPress={() => onChange(tab.key)}
          />
        ))}
      </View>
    </View>
  );
}

function TabButton({
  tab,
  active,
  onPress,
}: {
  tab: TabSpec;
  active: boolean;
  onPress: () => void;
}) {
  const tint = active ? colors.accent : colors.textTertiary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        { opacity: pressed ? 0.7 : 1 },
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
    >
      <Icon name={tab.icon} size="md" color={tint} />
      <Text style={[styles.label, { color: tint }]}>{tab.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.glass,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing[2],
    paddingTop: spacing[2],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    gap: spacing[1],
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing[4],
    marginTop: -spacing[4],
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabSpacer: {
    width: 56 + spacing[4] * 2,
    marginTop: -spacing[4],
  },
});
