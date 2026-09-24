/**
 * FieldEdge — main app entry.
 *
 * Screens:
 *   search          Home with SearchScreen + Capture + Sync buttons
 *   capture         CaptureScreen full-screen
 *   report          SyncReportScreen (last sync result)
 *   onboarding      First-launch welcome
 *   settings        SettingsScreen (gear icon)
 *   album           AlbumScreen (date-grouped grid)
 *   map             MapScreen (GPS pin overlay)
 *   photo-preview   PhotoPreviewScreen (full-size image + metadata)
 *   conflict-detail ConflictDetailScreen (per-photo audit trail)
 *
 * PhotoPreviewScreen is the shared destination for Search/Album/Map taps.
 * ConflictDetailScreen is reached from the SyncReportScreen's conflict
 * rows; it carries its own photoId from the conflict entry, not from App.
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
import { AlbumScreen } from './src/screens/AlbumScreen';
import { MapScreen } from './src/screens/MapScreen';
import { PhotoPreviewScreen } from './src/screens/PhotoPreviewScreen';
import { ConflictDetailScreen } from './src/screens/ConflictDetailScreen';

type Screen =
  | 'search'
  | 'capture'
  | 'report'
  | 'onboarding'
  | 'settings'
  | 'album'
  | 'map'
  | 'photo-preview'
  | 'conflict-detail';

export default function App() {
  const [screen, setScreen] = useState<Screen>('search');
  const [bootReady, setBootReady] = useState(false);
  const [shardStatus, setShardStatus] = useState('Not initialized');
  const [pointCount, setPointCount] = useState(0);
  const [version, setVersion] = useState<{ status: string; value?: { crate: string; version: string; rust_version: string; features: Record<string, boolean> } } | null>(null);
  const [syncReport, setSyncReport] = useState<SyncMetrics | null>(null);
  const [currentPhotoId, setCurrentPhotoId] = useState<string>('');
  const { status, lastReport, triggerSync, setPendingCount } = useSyncStore();
  const resetSettings = useSettingsStore((s) => s.reset);

  useEffect(() => {
    initialize();
  }, []);

  const initialize = async () => {
    try {
      const token = await getDeviceToken();
      apiClient.setToken(token);

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

  useEffect(() => {
    if (!bootReady) return;
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const hydrated = useSettingsStore.persist.hasHydrated();
      if (!hydrated) {
        setTimeout(check, 50);
        return;
      }
      if (!useSettingsStore.getState().hasOnboarded && screen === 'search') {
        setScreen('onboarding');
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [bootReady, screen]);

  const openPhoto = (photoId: string) => {
    setCurrentPhotoId(photoId);
    setScreen('photo-preview');
  };

  const onCaptured = async (photoId: string) => {
    setScreen('search');
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
      setSyncReport(report ?? lastReport);
      setScreen('report');
    } catch (err) {
      Alert.alert('Sync failed', String(err));
    }
  };

  if (screen === 'capture') {
    return (
      <CaptureScreen
        onCaptured={onCaptured}
        onCancel={() => setScreen('search')}
      />
    );
  }

  if (screen === 'report') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SyncReportScreen
          report={syncReport}
          onClose={() => setScreen('search')}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'onboarding') {
    return (
      <OnboardingScreen onDone={() => setScreen('search')} />
    );
  }

  if (screen === 'settings') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SettingsScreen
          onClose={() => setScreen('search')}
          onLogout={() => {
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

  if (screen === 'album') {
    return (
      <AlbumScreen
        onBack={() => setScreen('search')}
        onPhotoPress={openPhoto}
      />
    );
  }

  if (screen === 'map') {
    return (
      <MapScreen
        onBack={() => setScreen('search')}
        onOpenPhoto={openPhoto}
      />
    );
  }

  if (screen === 'photo-preview') {
    return (
      <PhotoPreviewScreen
        photoId={currentPhotoId}
        onClose={() => setScreen('search')}
      />
    );
  }

  if (screen === 'conflict-detail') {
    return (
      <ConflictDetailScreen
        photoId={currentPhotoId}
        onClose={() => setScreen('search')}
      />
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

        <SearchScreen
          onPhotoPress={openPhoto}
          activeTab="search"
          onTabChange={(tab) => setScreen(tab)}
        />

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
