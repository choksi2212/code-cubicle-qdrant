/**
 * AlbumScreen — date-grouped browse of every photo in the local shard.
 *
 * Sections are bucketed by recency (Today / Yesterday / This week /
 * This month / Older) so a researcher with hundreds of photos can
 * scroll to the right time slice without scrubbing a flat grid.
 *
 * Each cell is Reanimated-stagger-faded-in on first render.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { fieldEdge, PointInput } from '../native/fieldEdge';
import { photoFileUriFromRelative } from '../config';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  onBack: () => void;
  onPhotoPress: (photoId: string) => void;
}

type Bucket = 'Today' | 'Yesterday' | 'This week' | 'This month' | 'Older';

const BUCKET_ORDER: Bucket[] = [
  'Today',
  'Yesterday',
  'This week',
  'This month',
  'Older',
];

function bucketFor(isoTs: string, now: Date): Bucket {
  const ts = new Date(isoTs);
  if (isNaN(ts.getTime())) return 'Older';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
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

interface Cell {
  photoId: string;
  photoPath: string;
  capturedAt: string;
}

interface Section {
  title: Bucket;
  data: Cell[];
}

export function AlbumScreen({ onBack, onPhotoPress }: Props) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const points = await fieldEdge.retrieve([]);
      const buckets = new Map<Bucket, Cell[]>();
      for (const p of points) {
        if (!p.payload) continue;
        const cell: Cell = {
          photoId: p.payload.photo_id ?? p.id,
          photoPath: p.payload.file_path,
          capturedAt: p.payload.captured_at,
        };
        const b = bucketFor(p.payload.captured_at, new Date());
        const list = buckets.get(b);
        if (list) list.push(cell);
        else buckets.set(b, [cell]);
      }
      for (const list of buckets.values()) {
        list.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
      }
      setSections(
        BUCKET_ORDER.filter((b) => buckets.has(b)).map((b) => ({
          title: b,
          data: buckets.get(b) ?? [],
        })),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalPhotos = useMemo(
    () => sections.reduce((sum, s) => s.data.length, 0),
    [sections],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <PressableScale onPress={onBack} hitSlop={12}>
          <View style={styles.backRow}>
            <Icon name="ChevronLeft" size="sm" color={colors.textSecondary} />
            <Text style={styles.backLabel}>Back</Text>
          </View>
        </PressableScale>
        <Text style={styles.title}>Album</Text>
        <Text style={styles.subtitle}>{totalPhotos} photos on this device</Text>
      </View>

      {error ? (
        <View style={styles.center}>
          <EmptyState
            icon="AlertTriangle"
            title="Couldn't load album"
            subtitle={error}
            actionLabel="Retry"
            onAction={load}
          />
        </View>
      ) : !loading && sections.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="Image"
            title="No photos yet"
            subtitle="Capture a photo to start your album."
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        >
          {sections.map((section, sectionIdx) => (
            <View key={section.title} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.sectionBadge}>
                  <Text style={styles.sectionBadgeText}>{section.data.length}</Text>
                </View>
              </View>
              <View style={styles.grid}>
                {section.data.map((cell, idx) => (
                  <StaggerCell
                    key={cell.photoId}
                    cell={cell}
                    index={idx}
                    sectionIdx={sectionIdx}
                    onPress={() => onPhotoPress(cell.photoId)}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function StaggerCell({
  cell,
  index,
  sectionIdx,
  onPress,
}: {
  cell: Cell;
  index: number;
  sectionIdx: number;
  onPress: () => void;
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.96);
  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  useEffect(() => {
    const delay = (sectionIdx * 60) + index * 24;
    opacity.value = withDelay(delay, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    scale.value = withDelay(delay, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
  }, [opacity, scale, index, sectionIdx]);

  return (
    <Animated.View style={[styles.cellWrap, animStyle]}>
      <PressableScale onPress={onPress} style={styles.cell}>
        <Image
          source={{ uri: photoFileUriFromRelative(cell.photoPath) }}
          style={styles.thumb}
          resizeMode="cover"
        />
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

  scroll: { paddingBottom: spacing[8] },

  section: { marginTop: spacing[5] },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    marginBottom: spacing[2],
    gap: spacing[2],
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  sectionBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
  },
  sectionBadgeText: { ...typography.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing[3],
  },
  cellWrap: { width: '33.333%', padding: 2 },
  cell: {
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
});
