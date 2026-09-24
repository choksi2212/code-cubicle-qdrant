/**
 * AlbumScreen — date-grouped browse of every photo in the local shard.
 *
 * Sections are bucketed by recency ("Today", "Yesterday", "This week",
 * "This month", "Older") so a researcher with hundreds of photos can
 * scroll to the right time slice without scrubbing a flat grid.
 *
 * Data flow: on mount and on pull-to-refresh we call `fieldEdge.retrieve`
 * with no IDs, which returns every PointInput from the on-disk shard.
 * The shard is bounded by FR-024 (5 000 photos max) so a single call is
 * fine — we don't need pagination here.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fieldEdge, PointInput } from '../native/fieldEdge';
import { PhotoGrid, PhotoGridItem } from '../components/PhotoGrid';

interface Props {
  onBack: () => void;
  onPhotoPress: (photoId: string) => void;
}

type Bucket = 'Today' | 'Yesterday' | 'This week' | 'This month' | 'Older';

interface Section {
  title: Bucket;
  data: PhotoGridItem[];
}

const BUCKET_ORDER: Bucket[] = [
  'Today',
  'Yesterday',
  'This week',
  'This month',
  'Older',
];

/**
 * Bucket an ISO timestamp into one of the five recency windows. Comparison
 * is against local midnight so "today" means the user's local day, not UTC.
 */
function bucketFor(isoTs: string, now: Date): Bucket {
  const ts = new Date(isoTs);
  if (isNaN(ts.getTime())) return 'Older';

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (ts >= todayStart) return 'Today';
  if (ts >= yesterdayStart) return 'Yesterday';
  if (ts >= weekStart) return 'This week';
  if (ts >= monthStart) return 'This month';
  return 'Older';
}

function groupByBucket(points: PointInput[], now: Date): Section[] {
  const buckets = new Map<Bucket, PhotoGridItem[]>();
  for (const p of points) {
    const payload = p.payload;
    if (!payload) continue;
    const item: PhotoGridItem = {
      photoId: payload.photo_id ?? p.id,
      photoPath: payload.file_path,
      capturedAt: payload.captured_at,
      lat: payload.lat,
      lng: payload.lng,
    };
    const bucket = bucketFor(payload.captured_at, now);
    const list = buckets.get(bucket);
    if (list) list.push(item);
    else buckets.set(bucket, [item]);
  }
  // Sort each bucket by capture time descending (newest first).
  for (const list of buckets.values()) {
    list.sort((a, b) =>
      new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    );
  }
  // Emit in canonical order; skip empty sections.
  return BUCKET_ORDER.filter((b) => buckets.has(b)).map((b) => ({
    title: b,
    data: buckets.get(b) ?? [],
  }));
}

export function AlbumScreen({ onBack, onPhotoPress }: Props) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // retrieve([]) returns every PointInput. The Rust side does the
      // equivalent of a full scan over the on-disk shard. Bounded by
      // FR-024 (≤ 5 000 photos) so we don't need pagination.
      const points = await fieldEdge.retrieve([]);
      setSections(groupByBucket(points, new Date()));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalPhotos = useMemo(
    () => sections.reduce((sum, s) => sum + s.data.length, 0),
    [sections],
  );

  // SectionList requires a flat-ish `data` shape; we use the bucketed
  // sections array and let PhotoGrid render each section's body. SectionList
  // invokes renderItem per item and renderSectionHeader once per section —
  // we ignore the per-item render and put the whole grid in the header.
  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionCount}>{section.data.length}</Text>
      </View>
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: PhotoGridItem }) => {
      // We render the whole grid in the section header so per-item rows
      // are unused — return an empty View to satisfy SectionList's API.
      // (PhotoGrid renders its own internal FlatList.)
      return <View />;
    },
    [],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Album</Text>
        <Text style={styles.count}>{totalPhotos}</Text>
      </View>

      {error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : sections.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No photos yet</Text>
          <Text style={styles.emptySubtext}>
            Capture a photo to start your album.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.photoId}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          renderSectionFooter={({ section }) => (
            <PhotoGrid
              photos={section.data}
              onPress={onPhotoPress}
              numColumns={3}
            />
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
        />
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
    fontSize: 14,
    fontWeight: '600',
    minWidth: 60,
    textAlign: 'right',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 8,
  },
  sectionTitle: {
    color: '#8B95A5',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionCount: {
    color: '#5B6573',
    fontSize: 12,
    fontWeight: '600',
  },
  list: { paddingBottom: 32 },
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
});
