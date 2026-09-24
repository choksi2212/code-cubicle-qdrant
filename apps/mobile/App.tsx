/**
 * FieldEdge — main app entry.
 *
 * 3-pane layout (top to bottom):
 *   1. Header (Rust version, project, sync status, gear icon → Settings)
 *   2. SearchScreen (text input + result grid)
 *   3. Capture button + Sync button
 *
 * Tapping Capture opens CaptureScreen full-screen. After a successful
 * capture, returns here and the search grid updates.
 *
 * On first launch (hasOnboarded=false) the user is dropped into
 * OnboardingScreen instead of the Home screen.
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fieldEdge } from './src/native/fieldEdge';
import { useSyncStore } from './src/stores/syncStore';
import { useSettingsStore } from './src/stores/settingsStore';
import { SyncMetrics } from './src/services/sync';
import { apiClient } from './src/services/api';
import { FIELD_SHARD_DIR, getDeviceToken } from './src/config';
import { warmUpClip } from './src/embedding/clip';
import { SearchScreen } from './src/screens/SearchScreen';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { SyncReportScreen } from './src/screens/SyncReportScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

type Screen = 'home' | 'capture' | 'report' | 'onboarding' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [bootReady, setBootReady] = useState(false);
  const [shardStatus, setShardStatus] = useState('Not initialized');
  const [pointCount, setPointCount] = useState(0);
  const [version, setVersion] = useState<{ status: string; value?: { crate: string; version: string; rust_version: string; features: Record<string, boolean> } } | null>(null);
  const [syncReport, setSyncReport] = useState<SyncMetrics | null>(null);
  const { status, lastReport, triggerSync, setPendingCount } = useSyncStore();
  const resetSettings = useSettingsStore((s) => s.reset);

  useEffect(() => {
    initialize();
  }, []);

  const initialize = async () => {
    try {
      // Initialize device identity + Bearer token before anything hits the API.
      const token = await getDeviceToken();
      apiClient.setToken(token);

      // FR-013 — warm up the CLIP ONNX sessions so the first capture is fast.
      // Fire-and-forget; failure is non-fatal (degraded mode kicks in).
      warmUpClip().catch(() => {});

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
      setPendingCount(count);
    } catch (err) {
      Alert.alert('Init failed', String(err));
      setShardStatus('❌ Failed');
    } finally {
      setBootReady(true);
    }
  };

  // Decide the initial screen after hydration. zustand's persist is async
  // — wait until both init() finishes and the store has rehydrated from
  // AsyncStorage so we don't flash Onboarding on a returning user.
  useEffect(() => {
    if (!bootReady) return;
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const hydrated = useSettingsStore.persist.hasHydrated();
      if (!hydrated) {
        // Wait one tick for hydration to finish.
        setTimeout(check, 50);
        return;
      }
      if (!useSettingsStore.getState().hasOnboarded && screen === 'home') {
        setScreen('onboarding');
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [bootReady, screen]);

  const onCaptured = async (photoId: string) => {
    setScreen('home');
    Alert.alert(
      'Captured',
      `Photo ${photoId.slice(0, 8)}… saved offline. Tap Sync to push to cloud.`,
    );
    const count = await fieldEdge.pointCount();
    setPointCount(count);
    setPendingCount(count);
  };

  const runSyncFlow = async () => {
    try {
      const report = await triggerSync();
      // Always show the report — even on errors — so the user sees what happened.
      setSyncReport(report ?? lastReport);
      setScreen('report');
    } catch (err) {
      // Store-level error (only if runSync itself throws; it now catches internally).
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

  if (screen === 'onboarding') {
    return (
      <OnboardingScreen onDone={() => setScreen('home')} />
    );
  }

  if (screen === 'settings') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SettingsScreen
          onClose={() => setScreen('home')}
          onLogout={() => {
            // Clear token + onboarding flag; AsyncStorage wipe is fire-and-
            // forget so we don't block the nav transition.
            apiClient.setToken('');
            AsyncStorage.multiRemove([
              '@fieldedge/device_id',
              '@fieldedge/device_token',
            ]).catch(() => {});
            resetSettings();
            setScreen('onboarding');
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title}>FieldEdge</Text>
            <Pressable
              onPress={() => setScreen('settings')}
              style={styles.gearBtn}
              hitSlop={12}
            >
              <Text style={styles.gearIcon}>⚙️</Text>
            </Pressable>
          </View>
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
          Built for Paytm × Qdrant hackathon
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116' },
  scroll: { paddingBottom: 48 },
  header: { padding: 24, paddingTop: 16 },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gearBtn: { padding: 8 },
  gearIcon: { fontSize: 22 },
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
