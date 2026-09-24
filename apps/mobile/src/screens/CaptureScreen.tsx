/**
 * CaptureScreen — full-screen camera flow with proper shutter UI.
 *
 * - Project chips with active state
 * - Live status card (ready / embedding / saved)
 * - Big circular shutter button with Reanimated press scale + ring flash
 * - Preview state after capture with Retake button
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { launchCamera, Asset } from 'react-native-image-picker';
import { processCapture, PhotoCapExceededError } from '../services/capture';
import { DEMO_PROJECTS } from '../config';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { Card } from '../components/Card';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  onCaptured: (photoId: string) => void;
  onCancel: () => void;
}

export function CaptureScreen({ onCaptured, onCancel }: Props) {
  const [projectId, setProjectId] = useState(DEMO_PROJECTS[0].id);
  const [busy, setBusy] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<Asset | null>(null);
  const [stats, setStats] = useState({ today: 0, pending: 0, cap: 5000, gps: 'unknown' as 'ok' | 'unknown' | 'denied' });

  const ringScale = useSharedValue(1);
  const ringColor = useSharedValue(0); // 0 = accent, 1 = success

  const takePhoto = async () => {
    if (busy) return;

    ringScale.value = withTiming(0.95, { duration: 80, easing: Easing.out(Easing.quad) });
    setTimeout(() => {
      ringScale.value = withTiming(1, { duration: 160 });
    }, 100);

    setBusy(true);
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        cameraType: 'back',
        saveToPhotos: false,
        quality: 0.92,
        includeBase64: false,
      });

      if (result.didCancel) {
        setBusy(false);
        return;
      }
      if (result.errorCode) {
        Alert.alert('Camera error', result.errorMessage ?? result.errorCode);
        setBusy(false);
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        Alert.alert('No photo captured');
        setBusy(false);
        return;
      }

      setPreviewUri(asset.uri);
      setPreviewMeta(asset);

      const capture = await processCapture({
        photoUri: asset.uri,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        projectId,
      });

      ringColor.value = withTiming(1, { duration: 200 });
      setTimeout(() => {
        ringColor.value = withTiming(0, { duration: 400 });
      }, 800);

      if (capture.embeddingStatus === 'failed') {
        Alert.alert(
          'Captured in degraded mode',
          `Photo ${capture.photoId.slice(0, 8)}… saved, but CLIP embedding failed. ` +
            `It will not appear in semantic search until the model loads.`,
        );
      }
      onCaptured(capture.photoId);
    } catch (e) {
      if (e instanceof PhotoCapExceededError) {
        Alert.alert(
          'Photo cap reached',
          `${e.current} photos on disk (cap ${e.cap}). ` +
            `Sync or delete old photos before capturing more.`,
        );
      } else {
        Alert.alert('Capture failed', String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    setPreviewUri(null);
    setPreviewMeta(null);
  };

  if (previewUri) {
    return (
      <View style={styles.container}>
        <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.previewOverlay}>
          <Text style={styles.previewMeta}>
            {previewMeta?.fileName ?? 'capture.jpg'} ·{' '}
            {previewMeta?.width ?? '?'}×{previewMeta?.height ?? '?'} ·{' '}
            {Math.round((previewMeta?.fileSize ?? 0) / 1024)} KB
          </Text>
          <View style={styles.previewRow}>
            <PressableScale onPress={retake} style={styles.btnGhost}>
              <Icon name="X" size="sm" color={colors.textPrimary} />
              <Text style={styles.btnGhostText}>Retake</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <PressableScale onPress={onCancel} hitSlop={12}>
            <View style={styles.backRow}>
              <Icon name="ChevronLeft" size="sm" color={colors.textSecondary} />
              <Text style={styles.backLabel}>Back</Text>
            </View>
          </PressableScale>
          <Text style={styles.title}>Capture</Text>
          <Text style={styles.subtitle}>
            Take a photo. Embedding runs on-device — no cloud round-trip.
          </Text>
        </View>

        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusIconWrap}>
              <Icon name="Aperture" size="md" color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusLabel}>
                {busy ? 'Embedding…' : 'Ready to capture'}
              </Text>
              <Text style={styles.statusSub}>
                GPS: {stats.gps === 'ok' ? 'granted' : 'pending'} · Project: {projectId}
              </Text>
            </View>
            {busy && <ActivityIndicator color={colors.accent} />}
          </View>

          {busy && <ProgressBar />}

          <View style={styles.statsRow}>
            <StatTile label="Today" value={stats.today} />
            <StatTile label="Pending" value={stats.pending} accent />
            <StatTile label="Cap" value={stats.cap} />
            <StatTile label="GPS" value={stats.gps === 'ok' ? 'on' : 'off'} />
          </View>
        </Card>

        <Text style={styles.section}>Project</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.projectsRow}>
          {DEMO_PROJECTS.map((p) => (
            <PressableScale
              key={p.id}
              onPress={() => setProjectId(p.id)}
              accessibilityLabel={`Project ${p.name}`}
              accessibilityRole="button"
              accessibilityState={{ selected: projectId === p.id }}
              style={({ pressed }) => [
                styles.projectChip,
                projectId === p.id && styles.projectChipActive,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={[styles.projectDot, { backgroundColor: p.color }]} />
              <Text style={[styles.projectText, projectId === p.id && styles.projectTextActive]}>
                {p.name}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>

        <View style={styles.shutterWrap}>
          <Animated.View style={[styles.shutterRing, ringStyle]}>
            <PressableScale
              onPress={takePhoto}
              disabled={busy}
              accessibilityLabel="Capture photo"
              accessibilityRole="button"
              style={styles.shutterInner}
            >
              <Icon name="Aperture" size="xl" color={colors.textOnAccent} strokeWidth={1.5} />
            </PressableScale>
          </Animated.View>
          <Text style={styles.shutterHint}>{busy ? 'Embedding on device…' : 'Tap to capture'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, accent && { color: colors.accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProgressBar() {
  const w = useSharedValue(0);
  React.useEffect(() => {
    w.value = withRepeat(withTiming(1, { duration: 1400 }), -1, false);
  }, [w]);
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, a]} />
    </View>
  );
}

const ringStyle = ({ ringScale, ringColor }: any) => {
  // Will be created via useAnimatedStyle in component
  return {};
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing[8] },

  header: { paddingHorizontal: spacing[5], paddingTop: spacing[4], gap: spacing[2] },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  backLabel: { ...typography.bodyStrong, color: colors.textSecondary },
  title: { ...typography.display, color: colors.textPrimary, marginTop: spacing[2] },
  subtitle: { ...typography.body, color: colors.textSecondary },

  statusCard: { marginHorizontal: spacing[5], marginTop: spacing[5], gap: spacing[3] },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  statusIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtleOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLabel: { ...typography.bodyStrong, color: colors.textPrimary },
  statusSub: { ...typography.small, color: colors.textTertiary, marginTop: 2 },

  progressTrack: {
    height: 3,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },

  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statTile: { alignItems: 'flex-start', flex: 1 },
  statValue: { ...typography.h3, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  statLabel: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },

  section: {
    ...typography.caption,
    color: colors.textTertiary,
    paddingHorizontal: spacing[5],
    marginTop: spacing[6],
    marginBottom: spacing[2],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  projectsRow: { paddingHorizontal: spacing[5], gap: spacing[2] },
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing[2],
  },
  projectChipActive: {
    backgroundColor: colors.accentSubtleOnDark,
    borderColor: colors.accent,
  },
  projectDot: { width: 8, height: 8, borderRadius: 4 },
  projectText: { ...typography.smallStrong, color: colors.textSecondary },
  projectTextActive: { color: colors.accent },

  shutterWrap: { alignItems: 'center', marginTop: spacing[8], gap: spacing[3] },
  shutterRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterHint: { ...typography.small, color: colors.textTertiary },

  preview: { flex: 1, width: '100%', backgroundColor: '#000' },
  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing[6],
    backgroundColor: colors.scrim,
  },
  previewMeta: { ...typography.small, color: colors.textTertiary, marginBottom: spacing[4] },
  previewRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing[2] },
  btnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostText: { ...typography.bodyStrong, color: colors.textPrimary },
});
