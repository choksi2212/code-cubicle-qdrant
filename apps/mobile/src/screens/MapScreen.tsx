/**
 * MapScreen — spatial browse of every geo-tagged photo in the local shard.
 *
 * Pure-View marker overlay (no tile fetch — no privacy leak, fully
 * offline, no react-native-maps dep). v2 plan: opt-in map tiles via
 * settings flag. See docs/10-ALBUM-MAP.md for the design rationale.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { fieldEdge } from '../native/fieldEdge';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  onBack: () => void;
  onOpenPhoto: (photoId: string) => void;
}

interface Marker {
  photoId: string;
  lat: number;
  lng: number;
  capturedAt: string;
  ageDays: number;
}

const CANVAS = 320;

export function MapScreen({ onBack, onOpenPhoto }: Props) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const points = await fieldEdge.retrieve([]);
      const now = Date.now();
      const out: Marker[] = [];
      for (const p of points) {
        const payload = p.payload;
        if (!payload) continue;
        if (payload.gps_status !== 'ok') continue;
        if (payload.lat == null || payload.lng == null) continue;
        out.push({
          photoId: payload.photo_id ?? p.id,
          lat: payload.lat,
          lng: payload.lng,
          capturedAt: payload.captured_at,
          ageDays: (now - new Date(payload.captured_at).getTime()) / (24 * 3600 * 1000),
        });
      }
      setMarkers(out);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { minLat, maxLat, minLng, maxLng } = useMemo(() => {
    if (markers.length === 0) return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
    let mnLa = markers[0].lat, mxLa = markers[0].lat, mnLn = markers[0].lng, mxLn = markers[0].lng;
    for (const m of markers) {
      if (m.lat < mnLa) mnLa = m.lat;
      if (m.lat > mxLa) mxLa = m.lat;
      if (m.lng < mnLn) mnLn = m.lng;
      if (m.lng > mxLn) mxLn = m.lng;
    }
    // Pad the box a bit so markers don't sit on the edge
    const latPad = (mxLa - mnLa) * 0.1 || 0.005;
    const lngPad = (mxLn - mnLn) * 0.1 || 0.005;
    return { minLat: mnLa - latPad, maxLat: mxLa + latPad, minLng: mnLn - lngPad, maxLng: mxLn + lngPad };
  }, [markers]);

  const project = (m: Marker) => {
    const x = ((m.lng - minLng) / Math.max(maxLng - minLng, 1e-9)) * CANVAS;
    // invert Y so north is up
    const y = ((maxLat - m.lat) / Math.max(maxLat - minLat, 1e-9)) * CANVAS;
    return { x, y };
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <PressableScale onPress={onBack} hitSlop={12}>
          <View style={styles.backRow}>
            <Icon name="ChevronLeft" size="sm" color={colors.textSecondary} />
            <Text style={styles.backLabel}>Back</Text>
          </View>
        </PressableScale>
        <Text style={styles.title}>Map</Text>
        <Text style={styles.subtitle}>{markers.length} plotted</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Loading…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="AlertTriangle" title="Couldn't load map" subtitle={error} />
        </View>
      ) : markers.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="MapPin"
            title="No GPS data yet"
            subtitle="Enable location permission when capturing to plot photos here."
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.mapCanvas, { width: CANVAS, height: CANVAS }]}>
            <View style={styles.gridLineH} />
            <View style={styles.gridLineV} />
            <View style={[styles.gridLineH, { top: CANVAS / 4 }]} />
            <View style={[styles.gridLineH, { top: (CANVAS * 3) / 4 }]} />
            <View style={[styles.gridLineV, { left: CANVAS / 4 }]} />
            <View style={[styles.gridLineV, { left: (CANVAS * 3) / 4 }]} />
            {markers.map((m) => {
              const { x, y } = project(m);
              const size = m.ageDays < 30 ? 18 : m.ageDays < 90 ? 14 : 10;
              return (
                <MarkerPin
                  key={m.photoId}
                  x={x - size / 2}
                  y={y - size / 2}
                  size={size}
                  onPress={() => onOpenPhoto(m.photoId)}
                />
              );
            })}
          </View>
          <View style={styles.legend}>
            <View style={styles.legendDot} />
            <Text style={styles.legendText}>GPS captured</Text>
            <View style={[styles.legendDot, { backgroundColor: colors.surfaceElevated }]} />
            <Text style={styles.legendText}>No GPS</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function MarkerPin({ x, y, size, onPress }: { x: number; y: number; size: number; onPress: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[styles.markerWrap, { left: x, top: y, width: size, height: size }, animStyle]}>
      <PressableScale
        onPress={() => {
          scale.value = withSpring(1.6, { damping: 12, stiffness: 220 });
          setTimeout(() => {
            scale.value = withSpring(1, { damping: 14, stiffness: 200 });
            onPress();
          }, 120);
        }}
        style={[styles.marker, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View style={[styles.markerInner, { width: size / 2, height: size / 2, borderRadius: size / 4 }]} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing[5], paddingTop: spacing[4], gap: spacing[2] },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  backLabel: { ...typography.bodyStrong, color: colors.textSecondary },
  title: { ...typography.display, color: colors.textPrimary, marginTop: spacing[1] },
  subtitle: { ...typography.body, color: colors.textSecondary },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  muted: { ...typography.body, color: colors.textTertiary },

  scroll: { padding: spacing[5], alignItems: 'center' },
  mapCanvas: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 1,
    backgroundColor: colors.border,
    opacity: 0.5,
  },

  markerWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  marker: {
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerInner: {
    backgroundColor: colors.bg,
  },

  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  legendDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  legendText: { ...typography.small, color: colors.textSecondary, marginRight: spacing[2] },
});
