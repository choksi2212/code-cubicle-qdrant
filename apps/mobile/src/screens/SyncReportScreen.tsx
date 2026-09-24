/**
 * SyncReportScreen — shows the result of the last sync run.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SyncMetrics as SyncReport } from '../services/sync';

interface Props {
  report: SyncReport | null;
  onClose: () => void;
}

export function SyncReportScreen({ report, onClose }: Props) {
  if (!report) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No sync yet</Text>
        <Text style={styles.subtitle} onPress={onClose}>Close</Text>
      </View>
    );
  }

  const duration = report.finishedAt.getTime() - report.startedAt.getTime();

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
        <Text style={styles.label}>Conflicts</Text>
        <Text style={[styles.value, styles.orange]}>{report.conflicts}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Resolved</Text>
        <Text style={[styles.value, styles.green]}>{report.resolved}</Text>
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
  closeText: {
    color: '#00BFA6',
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 32,
    fontSize: 16,
    fontWeight: '600',
  },
});
