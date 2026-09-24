/**
 * MapScreen — spatial browse of every geo-tagged photo in the local shard.
 *
 * Reads real GPS coordinates from payload.lat / payload.lng. Photos with
 * gps_status != "ok" are filtered out — we don't show markers for denied
 * or unavailable captures (those still appear in AlbumScreen).
 *
 * For v1 we use a pure-View marker overlay (see components/MapView.tsx for
 * the design rationale: no tile fetch = no privacy leak, works fully
 * offline, no react-native-maps dep). The v2 plan is to add an opt-in
 * map tile source behind a settings flag.
 *
 * Marker tap navigates to PhotoPreviewScreen with the photo_id; the
 * preview reads the JPEG from disk + the full payload from the shard.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fieldEdge } from '../native/fieldEdge';
import { MapView, MapMarker } from '../components/MapView';

interface Props {
  onBack: () => void;
  onOpenPhoto: (photoId: string) => void;
}

export function MapScreen({ onBack, onOpenPhoto }: Props) {
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const points = await fieldEdge.retrieve([]);
      const geoTagged: MapMarker[] = [];
      for (const p of points) {
        const payload = p.payload;
        if (!payload) continue;
        if (payload.gps_status !== 'ok') continue;
        if (payload.lat == null || payload.lng == null) continue;
        geoTagged.push({
          photoId: payload.photo_id ?? p.id,
          lat: payload.lat,
          lng: payload.lng,
          capturedAt: payload.captured_at,
        });
      }
      setMarkers(geoTagged);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleMarkerPress = useCallback(
    (photoId: string) => {
      onOpenPhoto(photoId);
    },
    [onOpenPhoto],
  );

  const hasGps = markers.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Map</Text>
        <Text style={styles.count}>{markers.length} plotted</Text>
      </View>

      {loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Loading…</Text>
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : !hasGps ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No GPS coordinates captured yet</Text>
          <Text style={styles.emptySubtext}>
            Enable location permission when capturing to plot photos here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <MapView
            markers={markers}
            onMarkerPress={handleMarkerPress}
            width={320}
            height={320}
          />
          <Text style={styles.help}>
            Tap a marker to open the photo. Larger dots are fresher captures
            (last 30 days).
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 8,
  },
  back: { color: '#00BFA6', fontSize: 14, fontWeight: '600' },
  title: { color: '#E6EAF0', fontSize: 22, fontWeight: 'bold' },
  count: {
    color: '#8B95A5',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 100,
    textAlign: 'right',
  },
  scroll: {
    padding: 16,
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: { color: '#5B6573', fontSize: 16, fontWeight: '600' },
  emptySubtext: {
    color: '#5B6573',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  help: {
    color: '#5B6573',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 24,
  },
});
