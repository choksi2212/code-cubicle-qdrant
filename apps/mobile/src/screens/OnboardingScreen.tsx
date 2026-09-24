/**
 * OnboardingScreen — three swipeable intro pages, Reanimated spring pager,
 * proper components (Icon, Card, PressableScale), no emojis.
 */

import React, { useCallback, useState } from 'react';
import {
  Dimensions,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  onDone: () => void;
}

interface PageSpec {
  title: string;
  subtitle: string;
  bullets?: Array<{ icon: IconName; label: string }>;
  steps?: Array<{ icon: IconName; label: string }>;
}

const SCREEN_WIDTH = Dimensions.get('window').width;

const PAGES: PageSpec[] = [
  {
    title: 'Field intelligence, in your pocket',
    subtitle:
      'Take photos in the field. AI-powered semantic search across every frame. Sync to the cloud when you are ready.',
    steps: [
      { icon: 'Aperture', label: 'Capture' },
      { icon: 'Sparkles', label: 'Embed' },
      { icon: 'Database', label: 'Store' },
      { icon: 'Upload', label: 'Sync' },
    ],
  },
  {
    title: 'How it works',
    subtitle:
      'Every photo is processed locally on your device. Nothing leaves until you tap Sync.',
    bullets: [
      { icon: 'Sparkles', label: 'On-device AI — no cloud round-trip' },
      { icon: 'Lock', label: 'Encrypted at rest via Android Keystore' },
      { icon: 'Upload', label: 'Syncs over WiFi when you ask' },
      { icon: 'Search', label: 'Search by meaning, not filename' },
    ],
  },
  {
    title: 'Grant permissions',
    subtitle:
      'We need two permissions to capture and tag photos. You can revoke either one later in Android Settings.',
  },
];

export function OnboardingScreen({ onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [pageIdx, setPageIdx] = useState(0);
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  const scrollX = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
    onMomentumEnd: (e) => {
      const idx = Math.round(e.contentOffset.x / SCREEN_WIDTH);
      setPageIdx(idx);
    },
  });

  const requestPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      const allGranted = Object.values(results).every(
        (v) => v === PermissionsAndroid.RESULTS.GRANTED,
      );
      setPermissionsGranted(allGranted);
    } catch {
      setPermissionsGranted(false);
    }
  }, []);

  const isLast = pageIdx === PAGES.length - 1;

  const dotStyle = (i: number) =>
    useAnimatedStyle(() => {
      const inputRange = [(i - 1) * SCREEN_WIDTH, i * SCREEN_WIDTH, (i + 1) * SCREEN_WIDTH];
      const width = interpolate(scrollX.value, inputRange, [8, 28, 8], Extrapolation.CLAMP);
      const opacity = interpolate(scrollX.value, inputRange, [0.4, 1, 0.4], Extrapolation.CLAMP);
      return { width, opacity };
    }, [i]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.brand}>FieldEdge</Text>
        {!isLast && (
          <PressableScale onPress={onDone} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </PressableScale>
        )}
      </View>

      <Animated.ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {PAGES.map((page, i) => (
          <View key={i} style={[styles.page, { width: SCREEN_WIDTH }]}>
            <View style={styles.heroWrap}>
              <HeroFor page={page} isLast={isLast} permissionsGranted={permissionsGranted} onRequest={requestPermissions} />
            </View>

            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.body}>{page.subtitle}</Text>

            {page.bullets && (
              <View style={styles.bullets}>
                {page.bullets.map((b, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <View style={styles.bulletIcon}>
                      <Icon name={b.icon} size="sm" color={colors.accent} />
                    </View>
                    <Text style={styles.bulletText}>{b.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {page.steps && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.stepsScroll}
              >
                {page.steps.map((s, j) => (
                  <View key={j} style={styles.stepCard}>
                    <View style={styles.stepIcon}>
                      <Icon name={s.icon} size="md" color={colors.accent} />
                    </View>
                    <Text style={styles.stepLabel}>{s.label}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        ))}
      </Animated.ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[4] }]}>
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: colors.accent },
                dotStyle(i),
              ]}
            />
          ))}
        </View>

        {isLast ? (
          <PressableScale
            onPress={() => {
              if (!permissionsGranted) {
                requestPermissions().then(() => onDone());
              } else {
                onDone();
              }
            }}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: permissionsGranted ? colors.success : colors.accent, opacity: pressed ? 0.92 : 1 },
            ]}
          >
            <Text style={styles.ctaText}>
              {permissionsGranted ? 'Get started' : 'Grant permissions & continue'}
            </Text>
            <Icon name="ChevronRight" size="sm" color={colors.textOnAccent} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

function HeroFor({
  page,
  isLast,
  permissionsGranted,
  onRequest,
}: {
  page: PageSpec;
  isLast: boolean;
  permissionsGranted: boolean;
  onRequest: () => void;
}) {
  if (page.steps) {
    return (
      <View style={styles.heroStacked}>
        <View style={[styles.stackedCircle, { transform: [{ translateX: 24 }, { translateY: 8 }] }]}>
          <Icon name={page.steps[1].icon} size="lg" color={colors.accent} />
        </View>
        <View style={[styles.stackedCircle, { transform: [{ translateX: 0 }, { translateY: 0 }] }]}>
          <Icon name={page.steps[0].icon} size="lg" color={colors.accent} />
        </View>
        <View style={[styles.stackedCircle, { transform: [{ translateX: 48 }, { translateY: 16 }] }]}>
          <Icon name={page.steps[2].icon} size="lg" color={colors.accent} />
        </View>
      </View>
    );
  }
  if (page.bullets) {
    return (
      <View style={styles.heroCenter}>
        <View style={[styles.stackedCircle, styles.stackedCircleLg]}>
          <Icon name="Sparkles" size="xl" color={colors.accent} strokeWidth={1.5} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.heroPermissions}>
      <PressableScale
        onPress={onRequest}
        style={({ pressed }) => [
          styles.permissionCard,
          permissionsGranted && { borderColor: colors.success, backgroundColor: colors.successSubtle },
        ]}
      >
        <View style={styles.permissionIconWrap}>
          <Icon name="Aperture" size="md" color={permissionsGranted ? colors.success : colors.accent} />
        </View>
        <View style={styles.permissionBody}>
          <Text style={styles.permissionLabel}>Camera</Text>
          <Text style={styles.permissionHint}>
            {permissionsGranted ? 'Granted' : 'Tap to grant'}
          </Text>
        </View>
        <Icon
          name={permissionsGranted ? 'CheckCircle2' : 'ChevronRight'}
          size="md"
          color={permissionsGranted ? colors.success : colors.textTertiary}
        />
      </PressableScale>
      <View style={[styles.permissionCard, { marginTop: spacing[3] }]}>
        <View style={styles.permissionIconWrap}>
          <Icon name="MapPin" size="md" color={colors.accent} />
        </View>
        <View style={styles.permissionBody}>
          <Text style={styles.permissionLabel}>Location</Text>
          <Text style={styles.permissionHint}>
            {permissionsGranted ? 'Granted' : 'Asked with camera'}
          </Text>
        </View>
        <Icon
          name={permissionsGranted ? 'CheckCircle2' : 'ChevronRight'}
          size="md"
          color={permissionsGranted ? colors.success : colors.textTertiary}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  brand: { ...typography.h2, color: colors.textPrimary },
  skip: { ...typography.bodyStrong, color: colors.textTertiary },

  pager: { flex: 1 },
  page: {
    paddingHorizontal: spacing[6],
    paddingTop: spacing[6],
  },

  heroWrap: { height: 200, justifyContent: 'center', alignItems: 'center', marginBottom: spacing[6] },
  heroStacked: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  heroCenter: { alignItems: 'center', justifyContent: 'center' },
  heroPermissions: { width: '100%' },

  stackedCircle: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackedCircleLg: {
    width: 128,
    height: 128,
    position: 'relative',
    top: 0,
    left: 0,
    marginLeft: 0,
  },

  title: {
    ...typography.display,
    color: colors.textPrimary,
    marginBottom: spacing[3],
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing[6],
    lineHeight: 22,
  },

  bullets: { gap: spacing[3] },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  bulletIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.accentSubtleOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletText: { ...typography.body, color: colors.textPrimary, flex: 1 },

  stepsScroll: { gap: spacing[3], paddingRight: spacing[6] },
  stepCard: {
    width: 96,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing[2],
    marginRight: spacing[2],
  },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtleOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: { ...typography.smallStrong, color: colors.textPrimary },

  permissionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  permissionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtleOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionBody: { flex: 1 },
  permissionLabel: { ...typography.bodyStrong, color: colors.textPrimary },
  permissionHint: { ...typography.small, color: colors.textTertiary, marginTop: 2 },

  footer: {
    paddingHorizontal: spacing[6],
    paddingTop: spacing[4],
    alignItems: 'stretch',
    gap: spacing[4],
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[1],
  },
  dot: {
    height: 4,
    borderRadius: radius.full,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[4],
    borderRadius: radius.md,
    gap: spacing[2],
  },
  ctaText: { ...typography.bodyStrong, color: colors.textOnAccent },
});
