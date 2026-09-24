/**
 * PhotoPreviewScreen — full-size photo view + metadata for a single point.
 *
 * Used by AlbumScreen (tap a thumbnail) and MapScreen (tap a marker).
 * Reads the point from the local shard via fieldEdge.retrieve, then
 * reads the JPEG bytes off disk via RNFS and renders it with <Image>.
 *
 * Metadata shown: photo_id, captured_at, lat/lng, project_id, device_id,
 * embedding_status, vector_checksum (truncated). Future enrichment
 * fields will surface here once they get populated.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import { fieldEdge, Payload } from '../native/fieldEdge';
import { photoAbsPath } from '../config';

interface Props {
  photoId: string;
  onClose: () => void;
}

interface Loaded {
  payload: Payload;
  absPath: string;
  exists: boolean;
}

export function PhotoPreviewScreen({ photoId, onClose }: Props) {
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

  const openErrorLog = () => {
    if (state?.exists) return;
    Alert.alert(
      'JPEG not on disk',
      'The point exists in the shard but the JPEG was not persisted to the sandbox. ' +
        'This can happen after a fresh install with no re-sync. Try Sync now.',
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Photo</Text>
        <View style={{ width: 60 }} />
      </View>

      {error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : !state ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#00BFA6" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {state.exists ? (
            <Image
              source={{ uri: 'file://' + state.absPath }}
              style={styles.preview}
              resizeMode="contain"
            />
          ) : (
            <Pressable style={styles.missing} onPress={openErrorLog}>
              <Text style={styles.missingTitle}>JPEG missing</Text>
              <Text style={styles.missingHint}>Tap for details</Text>
            </Pressable>
          )}

          <View style={styles.metaCard}>
            <Meta label="Photo ID" value={(state.payload.photo_id ?? photoId).slice(0, 8) + '…'} />
            <Meta label="Captured" value={new Date(state.payload.captured_at).toLocaleString()} />
            <Meta
              label="GPS"
              value={
                state.payload.gps_status === 'ok' && state.payload.lat != null && state.payload.lng != null
                  ? `${state.payload.lat.toFixed(5)}, ${state.payload.lng.toFixed(5)}`
                  : state.payload.gps_status
              }
            />
            <Meta label="Project" value={state.payload.project_id} />
            <Meta label="Device" value={state.payload.device_id.slice(0, 8) + '…'} />
            <Meta
              label="Embedding"
              value={state.payload.embedding_status}
              accent={
                state.payload.embedding_status === 'ok'
                  ? '#00BFA6'
                  : state.payload.embedding_status === 'failed'
                  ? '#EF4444'
                  : '#F5A524'
              }
            />
            {state.payload.synced_at ? (
              <Meta
                label="Synced"
                value={new Date(state.payload.synced_at).toLocaleString()}
              />
            ) : null}
            <Meta
              label="Checksum"
              value={state.payload.vector_checksum.slice(0, 16) + '…'}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Meta({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 8,
  },
  back: { color: '#00BFA6', fontSize: 14, fontWeight: '600' },
  title: { color: '#E6EAF0', fontSize: 22, fontWeight: 'bold' },
  scroll: { padding: 16, alignItems: 'stretch' },
  preview: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000',
    borderRadius: 12,
  },
  missing: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#1A1F26',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  missingTitle: { color: '#EF4444', fontSize: 16, fontWeight: '700' },
  missingHint: { color: '#5B6573', fontSize: 12, marginTop: 4 },
  metaCard: {
    marginTop: 16,
    backgroundColor: '#1A1F26',
    borderRadius: 12,
    padding: 16,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  metaLabel: { color: '#8B95A5', fontSize: 13 },
  metaValue: { color: '#E6EAF0', fontSize: 13, fontWeight: '600' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: { color: '#5B6573', fontSize: 16, fontWeight: '600' },
});
