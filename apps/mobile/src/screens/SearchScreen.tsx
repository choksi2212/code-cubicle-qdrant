/**
 * SearchScreen — text-input semantic search.
 *
 * Embeds query text via CLIP, calls Rust bridge query, displays results.
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
  FIELD_SHARD_DIR,
  DEMO_PROJECTS,
  photoFileUriFromRelative,
} from '../config';

interface Props {
  onPhotoPress: (hit: QueryHit) => void;
}

const SUGGESTIONS = [
  'river pollution',
  'forest canopy',
  'wildlife',
  'urban decay',
];

export function SearchScreen({ onPhotoPress }: Props) {
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
