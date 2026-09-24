/**
 * SyncReportScreen — shows the result of the last sync run.
 *
 * The header section lists counts (Started, Duration, Uploaded,
 * Downloaded, Errors, Bytes). When the run produced any conflict
 * resolutions, a "Conflicts" section appears below with a per-photo
 * row that drills into ConflictDetailScreen. The "Done" button is
 * always last.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SyncMetrics as SyncReport } from '../services/sync';

interface Props {
  report: SyncReport | null;
  onClose: () => void;
  onOpenConflict?: (photoId: string) => void;
}

export function SyncReportScreen({ report, onClose, onOpenConflict }: Props) {
  if (!report) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No sync yet</Text>
        <Text style={styles.subtitle} onPress={onClose}>Close</Text>
      </View>
    );
  }

  const duration = report.finishedAt.getTime() - report.startedAt.getTime();
  const conflictCount = report.conflicts.length;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Sync Report</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Started</Text>
        <Text style={styles.value}>{report.startedAt.toLocaleTimeString()}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Duration</Text>
        <Text style={styles.value}>{duration} ms</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Uploaded</Text>
        <Text style={[styles.value, styles.green]}>{report.uploaded}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Downloaded</Text>
        <Text style={[styles.value, styles.blue]}>{report.downloaded}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Errors</Text>
        <Text style={[styles.value, report.errors > 0 ? styles.red : styles.muted]}>
          {report.errors}
        </Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Bytes uploaded</Text>
        <Text style={styles.value}>{(report.bytesUploaded / 1024).toFixed(1)} KB</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Bytes downloaded</Text>
        <Text style={styles.value}>{(report.bytesDownloaded / 1024).toFixed(1)} KB</Text>
      </View>

      {conflictCount > 0 && (
        <View style={styles.conflictsBlock}>
          <Text style={styles.conflictsHeader}>
            {conflictCount} conflict{conflictCount === 1 ? '' : 's'} resolved
          </Text>
          {report.conflicts.map((c, idx) => {
            const short = c.photo_id.slice(0, 8);
            const changed = c.fields_changed.length > 0
              ? c.fields_changed.join(', ')
              : 'tap to view';
            return (
              <Pressable
                key={`${c.photo_id}-${idx}`}
                style={styles.conflictRow}
                onPress={() => onOpenConflict?.(c.photo_id)}
              >
                <Text style={styles.conflictShort}>{short}…</Text>
                <Text style={styles.conflictWinner}>{c.winner}</Text>
                <Text style={styles.conflictChanged}>{changed}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={styles.closeText} onPress={onClose}>Done</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116', padding: 24 },
  title: {
    color: '#E6EAF0',
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 24,
    marginBottom: 24,
  },
  subtitle: { color: '#8B95A5', marginTop: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1F26',
  },
  label: { color: '#8B95A5', fontSize: 14 },
  value: { color: '#E6EAF0', fontSize: 16, fontWeight: '500' },
  green: { color: '#00BFA6' },
  blue: { color: '#60A5FA' },
  orange: { color: '#F5A524' },
  red: { color: '#EF4444' },
  muted: { color: '#5B6573' },
  conflictsBlock: {
    marginTop: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1A1F26',
  },
  conflictsHeader: {
    color: '#F5A524',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  conflictRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1A1F26',
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  conflictShort: {
    color: '#E6EAF0',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  conflictWinner: {
    color: '#00BFA6',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#0E1116',
  },
  conflictChanged: {
    color: '#8B95A5',
    fontSize: 12,
    flex: 1,
  },
  closeText: {
    color: '#00BFA6',
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 32,
    fontSize: 16,
    fontWeight: '600',
  },
});
