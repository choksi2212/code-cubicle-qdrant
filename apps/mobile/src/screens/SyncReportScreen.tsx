/**
 * SyncReportScreen — polished summary of the last sync run.
 *
 * - Status hero card (success / partial / failed) with icon
 * - 2x2 metric grid with Reanimated count-up animations
 * - Conflicts list with tap-through to ConflictDetailScreen
 * - Done button at bottom
 */

import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { SyncMetrics } from '../services/sync';
import { Icon } from '../components/Icon';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { PressableScale } from '../components/PressableScale';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  report: SyncMetrics | null;
  onClose: () => void;
  onOpenConflict?: (photoId: string) => void;
}

export function SyncReportScreen({ report, onClose, onOpenConflict }: Props) {
  if (!report) {
    return (
      <View style={styles.empty}>
        <Text style={styles.title}>No sync yet</Text>
        <Button label="Close" variant="ghost" onPress={onClose} />
      </View>
    );
  }

  const duration = report.finishedAt.getTime() - report.startedAt.getTime();
  const hasErrors = report.errors > 0;
  const hasConflicts = report.conflicts.length > 0;

  const statusKind: 'success' | 'partial' | 'failed' =
    hasErrors ? 'failed' : hasConflicts ? 'partial' : 'success';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.header}>
        <Text style={styles.kicker}>SYNC REPORT</Text>
        <Text style={styles.title}>
          {statusKind === 'success' && 'All synced'}
          {statusKind === 'partial' && 'Partial sync'}
          {statusKind === 'failed' && 'Sync failed'}
        </Text>
        <Text style={styles.subtitle}>
          Started {report.startedAt.toLocaleTimeString()} · took {Math.round(duration / 1000)}s
        </Text>
      </View>

      <Card style={[styles.heroCard, statusKind === 'success' && styles.heroSuccess, statusKind === 'failed' && styles.heroDanger]}>
        <View style={styles.heroIconWrap}>
          <Icon
            name={statusKind === 'success' ? 'CheckCircle2' : statusKind === 'partial' ? 'AlertCircle' : 'AlertTriangle'}
            size="xl"
            color={statusKind === 'success' ? colors.success : statusKind === 'partial' ? colors.warning : colors.danger}
            strokeWidth={1.5}
          />
        </View>
        <Text style={styles.heroText}>
          {report.uploaded} uploaded · {report.downloaded} downloaded
        </Text>
        <Text style={styles.heroSub}>
          {report.conflicts.length} conflict{report.conflicts.length === 1 ? '' : 's'} resolved ·{' '}
          {report.errors} error{report.errors === 1 ? '' : 's'}
        </Text>
      </Card>

      <View style={styles.metricsGrid}>
        <MetricTile label="Uploaded" value={report.uploaded} icon="Upload" accent="success" delay={0} />
        <MetricTile label="Downloaded" value={report.downloaded} icon="Download" accent="info" delay={80} />
        <MetricTile label="Conflicts" value={report.conflicts.length} icon="AlertCircle" accent="warning" delay={160} />
        <MetricTile
          label="Errors"
          value={report.errors}
          icon="XCircle"
          accent={hasErrors ? 'danger' : 'muted'}
          delay={240}
        />
      </View>

      <Card style={styles.bytesCard}>
        <View style={styles.bytesRow}>
          <View style={styles.bytesItem}>
            <Icon name="Upload" size="sm" color={colors.textTertiary} />
            <Text style={styles.bytesLabel}>{(report.bytesUploaded / 1024).toFixed(1)} KB</Text>
          </View>
          <View style={styles.bytesItem}>
            <Icon name="Download" size="sm" color={colors.textTertiary} />
            <Text style={styles.bytesLabel}>{(report.bytesDownloaded / 1024).toFixed(1)} KB</Text>
          </View>
        </View>
      </Card>

      {hasConflicts && (
        <View style={styles.conflictsSection}>
          <Text style={styles.sectionLabel}>Conflicts</Text>
          {report.conflicts.map((c, i) => (
            <PressableScale
              key={i}
              onPress={() => onOpenConflict?.(c.photo_id)}
              style={({ pressed }) => [styles.conflictRow, pressed && { backgroundColor: colors.surfaceElevated }]}
            >
              <View style={styles.conflictThumb}>
                <Icon name="Image" size="md" color={colors.textTertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.conflictId}>{c.photo_id.slice(0, 8)}…</Text>
                <Text style={styles.conflictMeta}>
                  {c.winner.replace('_', ' ')} · {c.fields_changed.join(', ')}
                </Text>
              </View>
              <Icon name="ChevronRight" size="sm" color={colors.textTertiary} />
            </PressableScale>
          ))}
        </View>
      )}

      <Button label="Done" variant="primary" fullWidth onPress={onClose} />
    </ScrollView>
  );
}

function MetricTile({
  label,
  value,
  icon,
  accent,
  delay,
}: {
  label: string;
  value: number;
  icon: any;
  accent: 'success' | 'info' | 'warning' | 'danger' | 'muted';
  delay: number;
}) {
  const displayed = useSharedValue(0);
  useEffect(() => {
    displayed.value = withDelay(delay, withTiming(value, { duration: 600 }));
  }, [value, delay, displayed]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: 0.6 + 0.4 * (displayed.value / Math.max(value, 1)),
  }));

  const accentColor =
    accent === 'success' ? colors.success :
    accent === 'info' ? colors.info :
    accent === 'warning' ? colors.warning :
    accent === 'danger' ? colors.danger :
    colors.textTertiary;

  return (
    <Animated.View style={[styles.metricTile, animStyle]}>
      <View style={[styles.metricIconWrap, { backgroundColor: `${accentColor}26` }]}>
        <Icon name={icon} size="md" color={accentColor} />
      </View>
      <CountUp target={value} />
      <Text style={styles.metricLabel}>{label}</Text>
    </Animated.View>
  );
}

function CountUp({ target }: { target: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(target, { duration: 600 });
  }, [target, v]);
  const [display, setDisplay] = React.useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setDisplay(Math.round(v.value));
    }, 60);
    return () => clearInterval(id);
  }, [v]);
  return <Text style={styles.metricValue}>{display}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing[5], paddingBottom: spacing[8] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: spacing[4] },

  header: { marginBottom: spacing[5], gap: spacing[1] },
  kicker: { ...typography.caption, color: colors.textTertiary, letterSpacing: 1.2 },
  title: { ...typography.display, color: colors.textPrimary, marginTop: spacing[1] },
  subtitle: { ...typography.small, color: colors.textSecondary },

  heroCard: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    gap: spacing[2],
    marginBottom: spacing[5],
  },
  heroSuccess: { borderColor: colors.success, backgroundColor: colors.successSubtle },
  heroDanger: { borderColor: colors.danger, backgroundColor: colors.dangerSubtle },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  heroText: { ...typography.bodyStrong, color: colors.textPrimary },
  heroSub: { ...typography.small, color: colors.textTertiary },

  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginBottom: spacing[5],
  },
  metricTile: {
    width: '47.5%',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  metricIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: { ...typography.numeric, color: colors.textPrimary },
  metricLabel: { ...typography.small, color: colors.textTertiary },

  bytesCard: { marginBottom: spacing[5] },
  bytesRow: { flexDirection: 'row', justifyContent: 'space-between' },
  bytesItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  bytesLabel: { ...typography.smallStrong, color: colors.textSecondary, fontVariant: ['tabular-nums'] },

  conflictsSection: { marginBottom: spacing[5] },
  sectionLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing[3],
  },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing[2],
  },
  conflictThumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conflictId: { ...typography.bodyStrong, color: colors.textPrimary, fontFamily: 'monospace' },
  conflictMeta: { ...typography.small, color: colors.textTertiary, marginTop: 2 },

  title: { ...typography.h1, color: colors.textPrimary },
});
