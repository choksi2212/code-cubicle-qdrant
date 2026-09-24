/**
 * PhotoGrid — reusable thumbnail grid for browsing photo collections.
 *
 * Used by:
 *   - SearchScreen (semantic search results, score-badge variant)
 *   - AlbumScreen (date-grouped, plain thumbnails)
 *
 * Pull-to-refresh re-queries the local shard via fieldEdge.retrieve() so
 * captures that landed while the user was on another screen show up
 * without requiring a manual screen transition. The shard is small enough
 * (≤ 5 000 photos per FR-024 cap) that a single call returns everything.
 */

import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fieldEdge } from '../native/fieldEdge';
import { photoFileUriFromRelative } from '../config';

export interface PhotoGridItem {
  photoId: string;
  photoPath: string;
  capturedAt: string;
  lat: number | null;
  lng: number | null;
}

interface Props {
  photos: PhotoGridItem[];
  onPress: (photoId: string) => void;
  numColumns?: number;
  /** Optional callback fired after a successful refresh. */
  onRefresh?: () => void;
  /** When false, hides the pull-to-refresh control (e.g. when a parent is driving refresh). */
  refreshable?: boolean;
}

export function PhotoGrid({
  photos,
  onPress,
  numColumns = 3,
  onRefresh,
  refreshable = true,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Re-query the local shard; parent screen owns the resulting state.
      // We pass [] to mean "give me every point" — the Rust side handles
      // it the same way Qdrant Edge does (full scan over the on-disk shard).
      await fieldEdge.retrieve([]);
      onRefresh?.();
    } catch {
      // Swallow — refresh is best-effort. The user can pull again.
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  if (photos.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No photos yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={photos}
      keyExtractor={(item) => item.photoId}
      numColumns={numColumns}
      contentContainerStyle={styles.grid}
      refreshControl={
        refreshable ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#00BFA6"
            colors={['#00BFA6']}
          />
        ) : undefined
      }
      renderItem={({ item }) => (
        <Pressable style={styles.cell} onPress={() => onPress(item.photoId)}>
          <Image
            source={{ uri: photoFileUriFromRelative(item.photoPath) }}
            style={styles.thumb}
            resizeMode="cover"
          />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  grid: { padding: 4 },
  cell: {
    flex: 1 / 3,
    margin: 4,
    aspectRatio: 1,
    backgroundColor: '#1A1F26',
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: { color: '#5B6573', fontSize: 14 },
});
