/**
 * ConflictDetailScreen — side-by-side audit of a single photo's conflict.
 *
 * Three panels:
 *   1. Local    — payload as the device's last upload saw it (or "No local copy")
 *   2. Remote   — payload as the central cluster has it now
 *   3. Resolution — winner badge + fields_changed + resolved_at
 *
 * Fetches from `GET /sync/conflicts/:photo_id` on mount via
 * fetchConflictDetail(). Renders a loading state while in flight,
 * an error state on non-2xx, and the three panels on success.
 *
 * Backed by the Audit UX requirement (docs/11-CONFLICTS.md): a field
 * worker should be able to see "your photo was replaced by a newer
 * version from your colleague's tablet" and inspect both copies.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ConflictDetail,
  ConflictPayload,
  fetchConflictDetail,
} from '../services/conflict';

interface Props {
  photoId: string;
  onClose: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; detail: ConflictDetail };

export function ConflictDetailScreen({ photoId, onClose }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchConflictDetail(photoId)
      .then((detail) => {
        if (!cancelled) setState({ kind: 'ok', detail });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  if (state.kind === 'loading') {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading conflict…</Text>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.title}>Could not load conflict</Text>
        <Text style={styles.errorText}>{state.message}</Text>
        <Pressable onPress={onClose} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const { detail } = state;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Conflict Detail</Text>
      <Text style={styles.subtitle}>
        photo {detail.photo_id.slice(0, 8)}…
      </Text>

      <Text style={styles.panelHeader}>Local</Text>
      <View style={styles.panel}>
        {detail.local ? (
          <PayloadPanel payload={detail.local} />
        ) : (
          <Text style={styles.muted}>No local copy on the server.</Text>
        )}
      </View>

      <Text style={styles.panelHeader}>Remote</Text>
      <View style={styles.panel}>
        <PayloadPanel payload={detail.remote} />
      </View>

      <Text style={styles.panelHeader}>Resolution</Text>
      <View style={styles.panel}>
        <View style={styles.winnerBadgeRow}>
          <View
            style={[
              styles.winnerBadge,
              detail.winner === 'local' && styles.winnerBadgeLocal,
              detail.winner === 'remote' && styles.winnerBadgeRemote,
              detail.winner === 'merged' && styles.winnerBadgeMerged,
            ]}
          >
            <Text style={styles.winnerBadgeText}>{detail.winner}</Text>
          </View>
          <Text style={styles.muted}>winner</Text>
        </View>

        <Text style={styles.sectionLabel}>Fields changed</Text>
        {detail.fields_changed.length === 0 ? (
          <Text style={styles.muted}>None — payloads are identical.</Text>
        ) : (
          detail.fields_changed.map((f) => (
            <Text key={f} style={styles.fieldRow}>• {f}</Text>
          ))
        )}

        <Text style={styles.sectionLabel}>Resolved at</Text>
        <Text style={styles.value}>{detail.resolved_at}</Text>
      </View>

      <Pressable onPress={onClose} style={styles.backBtn}>
        <Text style={styles.backBtnText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

function PayloadPanel({ payload }: { payload: ConflictPayload }) {
  return (
    <View>
      <Row label="device_id" value={payload.device_id ?? '—'} />
      <Row label="captured_at" value={payload.captured_at ?? '—'} />
      <Row label="project_id" value={payload.project_id ?? '—'} />
      <Row
        label="local_updated_at"
        value={payload.local_updated_at ?? '—'}
      />
      <Row
        label="vector_checksum"
        value={payload.vector_checksum ?? '—'}
        mono
      />
      <Row
        label="enrichment_text"
        value={payload.enrichment_text ?? '—'}
      />
      <Row label="tags_v2" value={formatList(payload.tags_v2)} />
      <Row label="enrichment_tags" value={formatList(payload.enrichment_tags)} />
    </View>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text
        style={[styles.kvValue, mono && styles.mono]}
        numberOfLines={3}
      >
        {value}
      </Text>
    </View>
  );
}

function formatList(values: unknown): string {
  if (!Array.isArray(values) || values.length === 0) return '—';
  return values.map((v) => String(v)).join(', ');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116', padding: 24 },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: {
    color: '#E6EAF0',
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 24,
    marginBottom: 8,
  },
  subtitle: { color: '#8B95A5', marginBottom: 24, fontSize: 14 },
  muted: { color: '#8B95A5' },
  errorText: {
    color: '#EF4444',
    marginTop: 12,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
  panelHeader: {
    color: '#E6EAF0',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  panel: {
    backgroundColor: '#1A1F26',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#8B95A5',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  value: { color: '#E6EAF0', fontSize: 14 },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#0E1116',
  },
  kvLabel: { color: '#8B95A5', fontSize: 12, flex: 1 },
  kvValue: {
    color: '#E6EAF0',
    fontSize: 12,
    flex: 2,
    textAlign: 'right',
  },
  mono: { fontFamily: 'monospace' },
  winnerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  winnerBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#2A2F36',
  },
  winnerBadgeLocal: { backgroundColor: '#00BFA6' },
  winnerBadgeRemote: { backgroundColor: '#60A5FA' },
  winnerBadgeMerged: { backgroundColor: '#F5A524' },
  winnerBadgeText: {
    color: '#0E1116',
    fontWeight: '700',
    fontSize: 12,
  },
  fieldRow: {
    color: '#E6EAF0',
    fontSize: 14,
    paddingVertical: 2,
  },
  backBtn: {
    marginTop: 16,
    marginBottom: 32,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2A2F36',
    alignItems: 'center',
  },
  backBtnText: {
    color: '#00BFA6',
    fontSize: 16,
    fontWeight: '600',
  },
});
