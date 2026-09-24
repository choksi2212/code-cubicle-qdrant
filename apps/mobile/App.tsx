/**
 * FieldEdge — main app entry.
 *
 * Navigation model:
 *   Tab routes    — Library / Map / Settings, hosted under a ScreenScaffold
 *                   with a BottomTabBar at the bottom and a centred FAB
 *                   that opens Capture (the most common single action).
 *   Full-screen   — CaptureScreen, SyncReportScreen, OnboardingScreen,
 *                   PhotoPreviewScreen, ConflictDetailScreen.
 *
 * Tab state lives in component state; switching tabs is a fade/slide
 * inside the Scaffold. Navigating to a full-screen route replaces the
 * whole tree (no slide-from-right transition library is in use; this
 * foundation ships the components so the screen-redesign agents can
 * layer on react-navigation or react-native-screens later if they
 * want richer transitions).
 *
 * Sync:
 *   The "Sync now" pill button lives on the LibraryScreen header (the
 *   parallel screen-redesign agent owns that surface). The legacy
 *   `runSyncFlow` and `triggerSync` wiring stays — we just don't show
 *   it as a chip strip on the home screen.
 *
 * Emoji policy:
 *   The header previously rendered a gear emoji (⚙️). The new header
 *   uses the Sliders icon from lucide-react-native — same affordance,
 *   no emoji. Status pill on the Library header is an icon + text via
 *   the design tokens.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  StatusBar,
  StyleSheet,
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
import { MapScreen } from './src/screens/MapScreen';
import { PhotoPreviewScreen } from './src/screens/PhotoPreviewScreen';
import { ConflictDetailScreen } from './src/screens/ConflictDetailScreen';
import { ScreenScaffold } from './src/components/ScreenScaffold';
import { BottomTabBar } from './src/components/BottomTabBar';
import { colors } from './src/theme/tokens';

type Screen =
  | 'capture'
  | 'report'
  | 'onboarding'
  | 'library'
  | 'map'
  | 'settings'
  | 'photo-preview'
  | 'conflict-detail';

type Tab = 'library' | 'map' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('library');
  const [bootReady, setBootReady] = useState(false);
  const [shardStatus, setShardStatus] = useState('Not initialized');
  const [pointCount, setPointCount] = useState(0);
  const [version, setVersion] = useState<{
    status: string;
    value?: {
      crate: string;
      version: string;
      rust_version: string;
      features: Record<string, boolean>;
    };
  } | null>(null);
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
        openResult.status === 'ok' ? 'Open' : 'Failed',
      );

      const count = await fieldEdge.pointCount();
      setPointCount(count);
      setPendingCount(count);
    } catch (err) {
      Alert.alert('Init failed', String(err));
      setShardStatus('Failed');
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
      if (!useSettingsStore.getState().hasOnboarded && screen === 'library') {
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

  const openHit = (hit: { id: string }) => {
    openPhoto(hit.id);
  };

  const onCaptured = async (photoId: string) => {
    setScreen('library');
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

  const onLogout = () => {
    apiClient.setToken('');
    AsyncStorage.multiRemove([
      '@fieldedge/device_id',
      '@fieldedge/device_token',
    ]).catch(() => {});
    resetSettings();
    setScreen('onboarding');
  };

  // ─── Full-screen routes ────────────────────────────────────────────
  if (screen === 'capture') {
    return (
      <CaptureScreen
        onCaptured={onCaptured}
        onCancel={() => setScreen('library')}
      />
    );
  }

  if (screen === 'report') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SyncReportScreen
          report={syncReport}
          onClose={() => setScreen('library')}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'onboarding') {
    return <OnboardingScreen onDone={() => setScreen('library')} />;
  }

  if (screen === 'photo-preview') {
    return (
      <PhotoPreviewScreen
        photoId={currentPhotoId}
        onClose={() => setScreen('library')}
      />
    );
  }

  if (screen === 'conflict-detail') {
    return (
      <ConflictDetailScreen
        photoId={currentPhotoId}
        onClose={() => setScreen('library')}
      />
    );
  }

  // ─── Tab routes (Library / Map / Settings) ─────────────────────────
  const tab: Tab = screen === 'map' ? 'map' : screen === 'settings' ? 'settings' : 'library';

  const scaffoldTitle = (() => {
    switch (tab) {
      case 'library':
        return 'FieldEdge';
      case 'map':
        return 'Map';
      case 'settings':
        return 'Settings';
    }
  })();

  const scaffoldSubtitle = (() => {
    if (tab === 'library') {
      return `Offline-first AI · ${pointCount} photos`;
    }
    if (tab === 'map') {
      return shardStatus;
    }
    return undefined;
  })();

  const goToTab = (next: string) => {
    if (next === 'library') setScreen('library');
    else if (next === 'map') setScreen('map');
    else if (next === 'settings') setScreen('settings');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.scaffoldWrap}>
        <ScreenScaffold
          title={scaffoldTitle}
          subtitle={scaffoldSubtitle}
        >
          {tab === 'library' ? (
            <SearchScreen
              onPhotoPress={openHit as any}
              activeTab="search"
              onTabChange={(t) => {
                if (t === 'album') setScreen('library');
                else if (t === 'map') setScreen('map');
                else setScreen('library');
              }}
            />
          ) : null}
          {tab === 'map' ? (
            <MapScreen
              onBack={() => setScreen('library')}
              onOpenPhoto={openPhoto}
            />
          ) : null}
          {tab === 'settings' ? (
            <SettingsScreen onClose={goToTab.bind(null, 'library')} onLogout={onLogout} />
          ) : null}
        </ScreenScaffold>
      </View>
      <BottomTabBar
        tabs={[
          { key: 'library', label: 'Library', icon: 'Image' },
          { key: 'map', label: 'Map', icon: 'MapPin' },
          { key: 'settings', label: 'Settings', icon: 'Sliders' },
        ]}
        active={tab}
        onChange={goToTab}
        onFabPress={() => setScreen('capture')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scaffoldWrap: { flex: 1 },
});
