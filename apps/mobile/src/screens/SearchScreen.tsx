/**
 * SearchScreen — semantic search over the local photo shard.
 *
 * - Real Input component with leading search icon + trailing clear
 * - Filter chips with Reanimated layout transitions
 * - 3-column thumbnail grid with score badges
 * - Skeleton loading (pulsing gray rectangles) instead of a spinner
 * - Empty state with suggestion chips
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '../components/Icon';
import { Input } from '../components/Input';
import { PressableScale } from '../components/PressableScale';
import { EmptyState } from '../components/EmptyState';
import { fieldEdge, QueryHit } from '../native/fieldEdge';
import { embedText } from '../embedding/clip';
import { photoFileUriFromRelative } from '../config';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  onPhotoPress: (hit: QueryHit) => void;
}

const SUGGESTIONS = [
  'river pollution',
  'forest canopy',
  'wildlife',
  'urban decay',
];

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'tagged', label: 'Tagged' },
];

export function SearchScreen({ onPhotoPress }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QueryHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [filter, setFilter] = useState('all');

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLatencyMs(null);
      return;
    }
    setBusy(true);
    const t0 = Date.now();
    try {
      const vector = await embedText(q);
      if (!vector) {
        setResults([]);
        return;
      }
      const req = {
        vector,
        limit: 30,
        filter: undefined,
        with_payload: true,
        with_vector: false,
      };
      const hits = await fieldEdge.query(req);
      setResults(hits);
      setLatencyMs(Date.now() - t0);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleChange = (text: string) => {
    setQuery(text);
    runSearch(text);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setLatencyMs(null);
  };

  const hasQuery = query.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <Input
          value={query}
          onChangeText={handleChange}
          placeholder="Describe what you're looking for"
          leadingIcon="Search"
          trailingIcon={hasQuery ? 'X' : undefined}
          onTrailingIconPress={hasQuery ? handleClear : undefined}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersRow}
      >
        {FILTERS.map((f) => (
          <FilterChip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </ScrollView>

      {hasQuery && latencyMs !== null && (
        <Text style={styles.metaText}>
          {results.length} {results.length === 1 ? 'match' : 'matches'} in {latencyMs} ms
        </Text>
      )}

      {busy ? (
        <SkeletonGrid />
      ) : !hasQuery ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="Wand2"
            title="Search your library"
            subtitle="Describe what you're looking for and we'll find similar photos on-device."
          />
          <View style={styles.suggestionRow}>
            {SUGGESTIONS.map((s) => (
              <PressableScale
                key={s}
                onPress={() => {
                  setQuery(s);
                  runSearch(s);
                }}
                style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.surfaceElevated }]}
              >
                <Text style={styles.suggestionText}>{s}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <PressableScale onPress={() => onPhotoPress(item)} style={styles.card}>
              <Image
                source={{ uri: photoFileUriFromRelative(item.payload.file_path) }}
                style={styles.thumb}
                resizeMode="cover"
              />
              <View style={styles.scoreBadge}>
                <Text style={styles.scoreText}>{(item.score * 100).toFixed(0)}%</Text>
              </View>
              <View style={styles.projectBadge}>
                <Text style={styles.projectText} numberOfLines={1}>
                  {item.payload.project_id}
                </Text>
              </View>
            </PressableScale>
          )}
          ListEmptyComponent={
            <View style={styles.noResults}>
              <EmptyState
                icon="Search"
                title="No matches"
                subtitle="Try a different description — semantic search is fuzzy by design."
              />
            </View>
          }
        />
      )}
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      style={({ pressed }) => [
        styles.filter,
        active && styles.filterActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </PressableScale>
  );
}

function SkeletonCell() {
  const opacity = useSharedValue(0.3);
  React.useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 900 }), -1, true);
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.skelCell, animatedStyle]} />;
}

function SkeletonGrid() {
  return (
    <View style={styles.grid}>
      {Array.from({ length: 9 }).map((_, i) => (
        <SkeletonCell key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  filtersRow: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  filter: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing[2],
  },
  filterActive: {
    backgroundColor: colors.accentSubtleOnDark,
    borderColor: colors.accent,
  },
  filterText: { ...typography.smallStrong, color: colors.textTertiary },
  filterTextActive: { color: colors.accent },

  metaText: {
    ...typography.small,
    color: colors.textTertiary,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[2],
  },

  emptyWrap: { paddingTop: spacing[8], alignItems: 'center' },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
    marginTop: spacing[4],
    gap: spacing[2],
  },
  suggestion: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing[2],
    marginBottom: spacing[2],
  },
  suggestionText: { ...typography.small, color: colors.textPrimary },

  grid: {
    padding: spacing[3],
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    width: '32%',
    aspectRatio: 1,
    margin: '0.66%',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  scoreBadge: {
    position: 'absolute',
    top: spacing[1],
    right: spacing[1],
    backgroundColor: colors.accentSubtleOnDark,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  scoreText: { ...typography.caption, color: colors.accent },
  projectBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  projectText: { ...typography.caption, color: colors.textPrimary },

  noResults: { paddingTop: spacing[8] },

  skelCell: {
    width: '32%',
    aspectRatio: 1,
    margin: '0.66%',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
