/**
 * SearchScreen — text-input semantic search.
 *
 * Embeds query text via CLIP, calls Rust bridge query, displays results.
 *
 * Also exposes the top-row "Search | Album | Map" nav strip — the three
 * browse views of the local library. The active chip is highlighted with
 * the accent color; tapping a sibling chip navigates via the parent's
 * onTabChange callback (App.tsx wires it to setScreen).
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fieldEdge, QueryHit } from '../native/fieldEdge';
import { embedText } from '../embedding/clip';
import {
  photoFileUriFromRelative,
} from '../config';

export type SearchScreenTab = 'search' | 'album' | 'map';

interface Props {
  onPhotoPress: (hit: QueryHit) => void;
  activeTab?: SearchScreenTab;
  onTabChange?: (tab: SearchScreenTab) => void;
}

const SUGGESTIONS = [
  'river pollution',
  'forest canopy',
  'wildlife',
  'urban decay',
];

const TABS: { key: SearchScreenTab; label: string }[] = [
  { key: 'search', label: 'Search' },
  { key: 'album', label: 'Album' },
  { key: 'map', label: 'Map' },
];

export function SearchScreen({
  onPhotoPress,
  activeTab = 'search',
  onTabChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QueryHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const runSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setBusy(true);
    const t0 = Date.now();
    try {
      const vector = await embedText(q);
      if (!vector) {
        throw new Error('CLIP model not loaded — install clip-text-int8.onnx in assets/models/');
      }

      const req = {
        vector,
        limit: 20,
        filter: undefined,
        with_payload: true,
        with_vector: false,
      };
      const hits = await fieldEdge.query(req);
      setResults(hits);
      setLatencyMs(Date.now() - t0);
    } catch (e) {
      console.error('Search failed:', e);
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top-row nav strip. Active tab gets the accent color; others
          stay muted. Tapping a sibling fires onTabChange → App.tsx
          setScreen(). */}
      <View style={styles.tabStrip}>
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          return (
            <Pressable
              key={t.key}
              style={[
                styles.tab,
                isActive ? styles.tabActive : styles.tabInactive,
              ]}
              onPress={() => onTabChange?.(t.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  styles.tabLabel,
                  isActive ? styles.tabLabelActive : styles.tabLabelInactive,
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Describe what you're looking for…"
          placeholderTextColor="#5B6573"
          onSubmitEditing={() => runSearch(query)}
          returnKeyType="search"
        />
        {busy && <ActivityIndicator color="#00BFA6" />}
      </View>

      {query.length === 0 && (
        <View style={styles.suggestions}>
          <Text style={styles.suggestionsLabel}>Try:</Text>
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              style={styles.suggestionChip}
              onPress={() => {
                setQuery(s);
                runSearch(s);
              }}
            >
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {latencyMs !== null && query.length > 0 && (
        <Text style={styles.metaText}>
          {results.length} results in {latencyMs} ms
        </Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => onPhotoPress(item)}
          >
            <Image
              source={{ uri: photoFileUriFromRelative(item.payload.file_path) }}
              style={styles.thumb}
              resizeMode="cover"
            />
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>
                {(item.score * 100).toFixed(0)}%
              </Text>
            </View>
            <View style={styles.projectBadge}>
              <Text style={styles.projectText} numberOfLines={1}>
                {item.payload.project_id}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          !busy && query.length > 0 ? (
            <Text style={styles.emptyText}>No matches</Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116' },
  tabStrip: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: '#00BFA6' },
  tabInactive: { backgroundColor: '#1A1F26' },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabLabelActive: { color: '#003B33' },
  tabLabelInactive: { color: '#8B95A5' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#1A1F26',
    margin: 12,
    borderRadius: 12,
  },
  input: {
    flex: 1,
    color: '#E6EAF0',
    fontSize: 16,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 8,
  },
  suggestionsLabel: {
    color: '#8B95A5',
    marginRight: 4,
    alignSelf: 'center',
  },
  suggestionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2A2F36',
    borderRadius: 14,
  },
  suggestionText: { color: '#E6EAF0', fontSize: 12 },
  metaText: {
    color: '#8B95A5',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  grid: { padding: 8 },
  card: {
    flex: 1 / 3,
    margin: 4,
    aspectRatio: 1,
    backgroundColor: '#1A1F26',
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  scoreBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#00BFA6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  scoreText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  projectBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  projectText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '500',
  },
  emptyText: {
    color: '#5B6573',
    textAlign: 'center',
    marginTop: 32,
  },
});
