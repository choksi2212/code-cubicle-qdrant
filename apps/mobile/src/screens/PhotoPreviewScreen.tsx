/**
 * PhotoPreviewScreen — full-size photo view + metadata for a single point.
 *
 * Reached from Album, Map, Search, and Conflict rows. Reads the point
 * from the local shard via fieldEdge.retrieve, then reads the JPEG bytes
 * off disk via RNFS and renders it with <Image>.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import { fieldEdge, Payload } from '../native/fieldEdge';
import { photoAbsPath } from '../config';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  photoId: string;
  onClose: () => void;
  onDelete?: (photoId: string) => void;
}

interface Loaded {
  payload: Payload;
  absPath: string;
  exists: boolean;
}

export function PhotoPreviewScreen({ photoId, onClose, onDelete }: Props) {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const points = await fieldEdge.retrieve([photoId]);
        if (cancelled) return;
        if (points.length === 0) {
          setError('Photo not found in local shard');
          return;
        }
        const p = points[0];
        const absPath = photoAbsPath(
          p.payload.project_id,
          p.payload.device_id,
          p.payload.photo_id ?? photoId,
        );
        const exists = await RNFS.exists(absPath);
        if (cancelled) return;
        setState({ payload: p.payload, absPath, exists });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  const handleDelete = () => {
    Alert.alert(
      'Delete this photo?',
      'It will be removed from the local shard. The next sync will not re-upload it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            onDelete?.(photoId);
            onClose();
          },
        },
      ],
    );
  };

  if (error) {
    return (
      <View style={styles.container}>
        <Header onClose={onClose} />
        <View style={styles.center}>
          <EmptyState icon="AlertTriangle" title="Could not load photo" subtitle={error} />
        </View>
      </View>
    );
  }

  if (!state) {
    return (
      <View style={styles.container}>
        <Header onClose={onClose} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  const { payload, absPath, exists } = state;
  const gpsText =
    payload.gps_status === 'ok' && payload.lat != null && payload.lng != null
      ? `${payload.lat.toFixed(5)}, ${payload.lng.toFixed(5)}`
      : payload.gps_status;

  return (
    <View style={styles.container}>
      <Header onClose={onClose} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {exists ? (
          <Image source={{ uri: 'file://' + absPath }} style={styles.preview} resizeMode="contain" />
        ) : (
          <Pressable
            style={styles.missing}
            onPress={() =>
              Alert.alert(
                'JPEG not on disk',
                'The point exists in the shard but the JPEG file is missing. ' +
                  'Try Sync to re-download.',
              )
            }
          >
            <Icon name="ImageOff" size="xl" color={colors.danger} strokeWidth={1.5} />
            <Text style={styles.missingTitle}>Photo not on disk</Text>
            <Text style={styles.missingHint}>Tap for details</Text>
          </Pressable>
        )}

        <View style={styles.toolbar}>
          <ToolButton icon="Bookmark" label="Save" disabled />
          <ToolButton icon="Share" label="Share" disabled />
          {onDelete ? <ToolButton icon="Trash2" label="Delete" danger onPress={handleDelete} /> : null}
          <ToolButton icon="MoreHorizontal" label="More" disabled />
        </View>

        <Card style={styles.metaCard}>
          <MetaRow icon="Hash" label="Photo ID" value={(payload.photo_id ?? photoId).slice(0, 8) + '…'} mono />
          <MetaRow
            icon="Calendar"
            label="Captured"
            value={new Date(payload.captured_at).toLocaleString()}
          />
          <MetaRow icon="MapPin" label="GPS" value={gpsText} />
          <MetaRow icon="Folder" label="Project" value={payload.project_id} />
          <MetaRow icon="Smartphone" label="Device" value={payload.device_id.slice(0, 8) + '…'} mono />
          <MetaRow
            icon="Sparkles"
            label="Embedding"
            value={payload.embedding_status}
            accent={
              payload.embedding_status === 'ok'
                ? colors.success
                : payload.embedding_status === 'failed'
                ? colors.danger
                : colors.warning
            }
          />
          {payload.synced_at ? (
            <MetaRow
              icon="Clock"
              label="Synced"
              value={new Date(payload.synced_at).toLocaleString()}
            />
          ) : null}
          <MetaRow
            icon="Shield"
            label="Checksum"
            value={payload.vector_checksum.slice(0, 16) + '…'}
            mono
          />
        </Card>
      </ScrollView>
    </View>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.header}>
      <PressableScale onPress={onClose} hitSlop={12}>
        <View style={styles.backRow}>
          <Icon name="ChevronLeft" size="sm" color={colors.textSecondary} />
          <Text style={styles.backLabel}>Back</Text>
        </View>
      </PressableScale>
      <Text style={styles.title}>Photo</Text>
    </View>
  );
}

function MetaRow({
  icon,
  label,
  value,
  mono,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  mono?: boolean;
  accent?: string;
}) {
  return (
    <View style={styles.metaRow}>
      <View style={styles.metaIconWrap}>
        <Icon name={icon} size="sm" color={colors.textTertiary} />
      </View>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, mono && { fontFamily: 'monospace' }, accent ? { color: accent } : null]}>
        {value}
      </Text>
    </View>
  );
}

function ToolButton({
  icon,
  label,
  disabled,
  danger,
  onPress,
}: {
  icon: any;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.toolBtn,
        pressed && { backgroundColor: colors.surfaceElevated },
      ]}
    >
      <Icon
        name={icon}
        size="md"
        color={disabled ? colors.textDisabled : danger ? colors.danger : colors.textSecondary}
      />
      <Text
        style={[
          styles.toolLabel,
          disabled && { color: colors.textDisabled },
          danger && { color: colors.danger },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing[5], paddingTop: spacing[4], gap: spacing[2] },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  backLabel: { ...typography.bodyStrong, color: colors.textSecondary },
  title: { ...typography.display, color: colors.textPrimary, marginTop: spacing[1] },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },

  scroll: { padding: spacing[5], paddingBottom: spacing[8] },
  preview: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000',
    borderRadius: radius.lg,
  },
  missing: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: colors.dangerSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  missingTitle: { ...typography.bodyStrong, color: colors.danger },
  missingHint: { ...typography.small, color: colors.textTertiary },

  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing[3],
    marginTop: spacing[4],
  },
  toolBtn: {
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    gap: spacing[1],
  },
  toolLabel: { ...typography.caption, color: colors.textSecondary },

  metaCard: { marginTop: spacing[4] },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing[3],
  },
  metaIconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaLabel: { ...typography.small, color: colors.textTertiary, width: 80 },
  metaValue: { ...typography.bodyStrong, color: colors.textPrimary, flex: 1, textAlign: 'right' },
});
