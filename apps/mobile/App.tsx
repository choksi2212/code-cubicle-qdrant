/**
 * FieldEdge — main app entry.
 *
 * 3-pane layout (top to bottom):
 *   1. Header (Rust version, project, sync status)
 *   2. SearchScreen (text input + result grid)
 *   3. Capture button + Sync button
 *
 * Tapping Capture opens CaptureScreen full-screen. After a successful
 * capture, returns here and the search grid updates.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fieldEdge, QueryHit } from './src/native/fieldEdge';
import { useSyncStore } from './src/stores/syncStore';
import { runSync, SyncMetrics } from './src/services/sync';
import { FIELD_SHARD_DIR } from './src/config';
import { SearchScreen } from './src/screens/SearchScreen';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { SyncReportScreen } from './src/screens/SyncReportScreen';

type Screen = 'home' | 'capture' | 'report';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [shardStatus, setShardStatus] = useState('Not initialized');
  const [pointCount, setPointCount] = useState(0);
  const [version, setVersion] = useState<{ status: string; value?: { crate: string; version: string; rust_version: string; features: Record<string, boolean> } } | null>(null);
  const [syncReport, setSyncReport] = useState<SyncMetrics | null>(null);
  const { status, setStatus } = useSyncStore();

  useEffect(() => {
    initialize();
  }, []);

  const initialize = async () => {
    try {
      const ver = await fieldEdge.version();
      setVersion(ver);

      const openResult = await fieldEdge.openShard({
        directory: FIELD_SHARD_DIR,
      });
      setShardStatus(
        openResult.status === 'ok' ? '✅ Open' : '❌ Failed',
      );

      const count = await fieldEdge.pointCount();
      setPointCount(count);
    } catch (err) {
      Alert.alert('Init failed', String(err));
      setShardStatus('❌ Failed');
    }
  };

  const onCaptured = async (photoId: string) => {
    setScreen('home');
    Alert.alert(
      'Captured',
      `Photo ${photoId.slice(0, 8)}… saved offline. Tap Sync to push to cloud.`,
    );
    const count = await fieldEdge.pointCount();
    setPointCount(count);
  };

  const runSyncFlow = async () => {
    try {
      setStatus('syncing');
      const report = await runSync(undefined, (msg) =>
        console.log('[sync]', msg),
      );
      setSyncReport(report);
      setStatus('complete');
      setScreen('report');
    } catch (err) {
      setStatus('error');
      Alert.alert('Sync failed', String(err));
    }
  };

  if (screen === 'capture') {
    return (
      <CaptureScreen
        onCaptured={onCaptured}
        onCancel={() => setScreen('home')}
      />
    );
  }

  if (screen === 'report') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SyncReportScreen
          report={syncReport}
          onClose={() => setScreen('home')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>FieldEdge</Text>
          <Text style={styles.subtitle}>
            Offline-first AI · {pointCount} photos
          </Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor:
                    shardStatus.includes('✅')
                      ? '#00BFA6'
                      : '#EF4444',
                },
              ]}
            />
            <Text style={styles.statusText}>
              {shardStatus} · v{version?.value?.version ?? '?'}
            </Text>
          </View>
        </View>

        <SearchScreen onPhotoPress={(hit) => console.log('open', hit.id)} />

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => setScreen('capture')}
          >
            <Text style={styles.btnText}>📷 Capture</Text>
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnSecondary, status === 'syncing' && styles.btnBusy]}
            onPress={runSyncFlow}
            disabled={status === 'syncing'}
          >
            <Text style={styles.btnText}>
              {status === 'syncing' ? 'Syncing…' : '🔄 Sync now'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>
          Built for Paytm × Qdrant × Cloudinary hackathon
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116' },
  scroll: { paddingBottom: 48 },
  header: { padding: 24, paddingTop: 16 },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#E6EAF0',
  },
  subtitle: { fontSize: 14, color: '#8B95A5', marginTop: 4 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#8B95A5', fontSize: 12 },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 12,
  },
  btn: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#00BFA6' },
  btnSecondary: { backgroundColor: '#2A2F36' },
  btnBusy: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footer: {
    color: '#5B6573',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 32,
  },
});
