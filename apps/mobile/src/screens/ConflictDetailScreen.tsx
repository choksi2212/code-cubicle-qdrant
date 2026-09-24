/**
 * ConflictDetailScreen — side-by-side audit of a single photo's conflict.
 *
 * Shows Local vs Remote payloads, the resolution chosen, and which
 * fields changed. Reached from the SyncReportScreen's conflict list.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { fetchConflictDetail, ConflictDetail } from '../services/conflict';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  photoId: string;
  onClose: () => void;
}

export function ConflictDetailScreen({ photoId, onClose }: Props) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ok'; data: ConflictDetail } | { kind: 'error'; message: string }>(
    { kind: 'loading' },
  );

  useEffect(() => {
    let cancelled = false;
    if (!photoId) {
      setState({ kind: 'error', message: 'No photo id provided' });
      return;
    }
    (async () => {
      try {
        const data = await fetchConflictDetail(photoId);
        if (!cancelled) setState({ kind: 'ok', data });
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  if (state.kind === 'loading') {
    return (
      <View style={styles.container}>
        <Header onClose={onClose} title="Conflict" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.container}>
        <Header onClose={onClose} title="Conflict" />
        <View style={styles.center}>
          <EmptyState icon="AlertTriangle" title="Could not load conflict" subtitle={state.message} />
        </View>
      </View>
    );
  }

  const { data } = state;
  const winnerLabel =
    data.winner === 'local' ? 'Local version won' : data.winner === 'remote' ? 'Remote version won' : 'Fields merged';
  const winnerIcon = data.winner === 'local' ? 'ChevronLeft' : data.winner === 'remote' ? 'ChevronRight' : 'Layers';
  const winnerColor =
    data.winner === 'local' ? colors.info : data.winner === 'remote' ? colors.success : colors.accent;

  return (
    <View style={styles.container}>
      <Header onClose={onClose} title="Conflict" />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={[styles.winnerCard, { borderColor: winnerColor }]}>
          <View style={[styles.winnerIconWrap, { backgroundColor: `${winnerColor}26` }]}>
            <Icon name={winnerIcon} size="md" color={winnerColor} />
          </View>
          <Text style={styles.winnerTitle}>{winnerLabel}</Text>
          <Text style={styles.winnerSub}>
            {data.fields_changed.length} field{data.fields_changed.length === 1 ? '' : 's'} changed
          </Text>
        </Card>

        <Text style={styles.sectionLabel}>Changed fields</Text>
        <View style={styles.chipsRow}>
          {data.fields_changed.length === 0 ? (
            <Text style={styles.muted}>No fields changed</Text>
          ) : (
            data.fields_changed.map((f) => (
              <View key={f} style={styles.chip}>
                <Text style={styles.chipText}>{f}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.compareRow}>
          <PayloadColumn title="Local" payload={data.local} accent={colors.info} />
          <PayloadColumn title="Remote" payload={data.remote} accent={colors.success} highlightFields={data.fields_changed} />
        </View>

        {data.resolved_at && (
          <Text style={styles.resolvedAt}>
            Resolved at {new Date(data.resolved_at).toLocaleString()}
          </Text>
        )}

        <Button label="Done" variant="primary" fullWidth onPress={onClose} />
      </ScrollView>
    </View>
  );
}

function PayloadColumn({
  title,
  payload,
  accent,
  highlightFields,
}: {
  title: string;
  payload: ConflictDetail['local'] | ConflictDetail['remote'];
  accent: string;
  highlightFields?: string[];
}) {
  if (!payload) {
    return (
      <View style={[styles.column, styles.columnMissing]}>
        <Text style={styles.columnTitle}>{title}</Text>
        <Text style={styles.muted}>Unavailable</Text>
      </View>
    );
  }
  const rows: Array<[string, string | null | undefined]> = [
    ['Captured', payload.captured_at ? new Date(payload.captured_at).toLocaleString() : null],
    ['Project', payload.project_id],
    ['GPS', payload.gps_status],
    ['Embedding', payload.embedding_status],
  ];
  const highlight = new Set(highlightFields ?? []);
  return (
    <View style={[styles.column, { borderColor: accent }]}>
      <View style={[styles.columnHeader, { borderColor: accent }]}>
        <View style={[styles.columnDot, { backgroundColor: accent }]} />
        <Text style={styles.columnTitle}>{title}</Text>
      </View>
      {rows.map(([label, value]) => {
        const isHi = highlight.has(label.toLowerCase().replace(' ', '_'));
        return (
          <View
            key={label}
            style={[
              styles.columnRow,
              isHi && { backgroundColor: colors.warningSubtle, marginHorizontal: -spacing[2], paddingHorizontal: spacing[2] },
            ]}
          >
            <Text style={styles.columnLabel}>{label}</Text>
            <Text style={styles.columnValue}>{value ?? '—'}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Header({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <PressableScale onPress={onClose} hitSlop={12}>
        <View style={styles.backRow}>
          <Icon name="ChevronLeft" size="sm" color={colors.textSecondary} />
          <Text style={styles.backLabel}>Back</Text>
        </View>
      </PressableScale>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing[5], paddingTop: spacing[4], gap: spacing[2] },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  backLabel: { ...typography.bodyStrong, color: colors.textSecondary },
  title: { ...typography.display, color: colors.textPrimary, marginTop: spacing[1] },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  muted: { ...typography.small, color: colors.textTertiary, textAlign: 'center' },

  scroll: { padding: spacing[5], paddingBottom: spacing[8], gap: spacing[4] },

  winnerCard: { alignItems: 'center', paddingVertical: spacing[5], gap: spacing[1] },
  winnerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  winnerTitle: { ...typography.h2, color: colors.textPrimary },
  winnerSub: { ...typography.small, color: colors.textTertiary },

  sectionLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    backgroundColor: colors.warningSubtle,
    borderRadius: radius.full,
  },
  chipText: { ...typography.small, color: colors.warning },

  compareRow: { flexDirection: 'row', gap: spacing[3] },
  column: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing[3],
  },
  columnMissing: { opacity: 0.6 },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingBottom: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing[2],
  },
  columnDot: { width: 8, height: 8, borderRadius: 4 },
  columnTitle: { ...typography.bodyStrong, color: colors.textPrimary },
  columnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
  },
  columnLabel: { ...typography.small, color: colors.textTertiary },
  columnValue: { ...typography.smallStrong, color: colors.textPrimary, flex: 1, textAlign: 'right' },

  resolvedAt: { ...typography.small, color: colors.textTertiary, textAlign: 'center', marginTop: spacing[2] },
});
