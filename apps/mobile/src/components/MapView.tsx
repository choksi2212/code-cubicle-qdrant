/**
 * MapView — lightweight marker overlay drawn with plain RN Views.
 *
 * DESIGN DECISION (offline-first): We deliberately do NOT use a real map
 * library (react-native-maps, MapLibre, etc.) in v1. The reasons:
 *
 *   1. Privacy — fetching map tiles hands the user's location trail to a
 *      third-party tile provider (Mapbox / Google / OSM). FieldEdge's
 *      whole pitch is "the shard never leaves the device" — leaking the
 *      spatial density of a researcher's field site defeats that promise.
 *
 *   2. Offline-correctness — field workers routinely go off-grid. A map
 *      that needs tile downloads breaks the moment they do. A pure-View
 *      overlay always renders.
 *
 *   3. Bundle size + native deps — react-native-maps pulls a Google Maps
 *      API key and Play Services on Android, which inflates the APK by
 *      ~15 MB and adds a permission surface we don't want.
 *
 * The marker overlay is a square canvas with absolute-positioned circles.
 * Lat/lng axes are labeled but otherwise the background is blank — the
 * user reads density, not streets. Marker size scales with recency so
 * the freshest captures pop.
 *
 * V2 FOLLOW-UP: gate an opt-in `react-native-maps` integration behind a
 * settings flag (`Map tile source: none | mapbox | osm`). Default stays
 * `none` so the privacy story holds.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface MapMarker {
  photoId: string;
  lat: number;
  lng: number;
  capturedAt: string;
}

interface Props {
  markers: MapMarker[];
  /** Bounding box. If omitted, computed from marker positions. */
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  onMarkerPress: (photoId: string) => void;
  width?: number;
  height?: number;
}

interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Compute a bounding box that handles the degenerate case where every
 * marker is at the same point: we expand the box to a ~100m square so the
 * marker is actually visible.
 */
function computeBounds(markers: MapMarker[]): BoundingBox {
  if (markers.length === 0) {
    return { minLat: -1, maxLat: 1, minLng: -1, maxLng: 1 };
  }
  let minLat = +Infinity;
  let maxLat = -Infinity;
  let minLng = +Infinity;
  let maxLng = -Infinity;
  for (const m of markers) {
    if (m.lat < minLat) minLat = m.lat;
    if (m.lat > maxLat) maxLat = m.lat;
    if (m.lng < minLng) minLng = m.lng;
    if (m.lng > maxLng) maxLng = m.lng;
  }
  // Degenerate box (all markers share coords) — expand by ~0.001 deg ≈ 111m
  if (maxLat - minLat < 1e-6) {
    const center = (maxLat + minLat) / 2;
    minLat = center - 5e-4;
    maxLat = center + 5e-4;
  }
  if (maxLng - minLng < 1e-6) {
    const center = (maxLng + minLng) / 2;
    minLng = center - 5e-4;
    maxLng = center + 5e-4;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function project(
  lat: number,
  lng: number,
  bounds: BoundingBox,
  width: number,
  height: number,
): { x: number; y: number } {
  const xRatio = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
  const yRatio = 1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat);
  // Leave 12 px padding so markers at the edge don't clip the canvas.
  const PAD = 12;
  const x = PAD + xRatio * (width - 2 * PAD);
  const y = PAD + yRatio * (height - 2 * PAD);
  return { x, y };
}

export function MapView({
  markers,
  bounds,
  onMarkerPress,
  width = 320,
  height = 320,
}: Props) {
  const effectiveBounds = useMemo(
    () => bounds ?? computeBounds(markers),
    [bounds, markers],
  );

  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days = "fresh"

  return (
    <View
      style={[styles.canvas, { width, height }]}
      accessibilityLabel="Map view (offline, no tiles)"
    >
      {/* Lat/Lng axis labels — top-left and bottom-right corners. */}
      <Text style={styles.axisTopLeft}>
        {effectiveBounds.maxLat.toFixed(3)}°
      </Text>
      <Text style={styles.axisBottomRight}>
        {effectiveBounds.minLng.toFixed(3)}°
      </Text>
      <Text style={styles.axisTopRight}>
        {effectiveBounds.maxLng.toFixed(3)}°
      </Text>
      <Text style={styles.axisBottomLeft}>
        {effectiveBounds.minLat.toFixed(3)}°
      </Text>

      {markers.map((m) => {
        const { x, y } = project(
          m.lat,
          m.lng,
          effectiveBounds,
          width,
          height,
        );
        const ageMs = now - new Date(m.capturedAt).getTime();
        // Fresh markers get a bigger, accent-colored dot; older ones fade.
        const isFresh = ageMs < maxAge;
        const size = isFresh ? 16 : 10;
        return (
          <Pressable
            key={m.photoId}
            onPress={() => onMarkerPress(m.photoId)}
            style={[
              styles.marker,
              {
                left: x - size / 2,
                top: y - size / 2,
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: isFresh ? '#00BFA6' : '#5B6573',
                opacity: isFresh ? 1 : 0.6,
              },
            ]}
            accessibilityLabel={`Photo at ${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: '#1A1F26',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#2A2F36',
  },
  marker: {
    position: 'absolute',
  },
  axisTopLeft: {
    position: 'absolute',
    top: 4,
    left: 6,
    color: '#5B6573',
    fontSize: 10,
  },
  axisTopRight: {
    position: 'absolute',
    top: 4,
    right: 6,
    color: '#5B6573',
    fontSize: 10,
  },
  axisBottomLeft: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    color: '#5B6573',
    fontSize: 10,
  },
  axisBottomRight: {
    position: 'absolute',
    bottom: 4,
    right: 6,
    color: '#5B6573',
    fontSize: 10,
  },
});
