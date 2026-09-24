/**
 * SettingsScreen — gear-icon screen exposed from the Home header.
 *
 * Grouped sections (SYNC / SERVER / PHOTOS / ACCOUNT / STORAGE / ABOUT)
 * with proper SegmentedControl, Stepper, and Avatar components.
 */

import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSettingsStore, SyncInterval } from '../stores/settingsStore';
import { useSyncStore } from '../stores/syncStore';
import { formatBytes, storageUsage, StorageUsage } from '../storage/storageUsage';
import { getDeviceToken } from '../config';
import { startSync, stopSync, runOnce } from '../services/syncScheduler';
import { Icon } from '../components/Icon';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { SegmentedControl } from '../components/SegmentedControl';
import { Stepper } from '../components/Stepper';
import { PressableScale } from '../components/PressableScale';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface Props {
  onClose: () => void;
  onLogout: () => void;
}

const APP_VERSION = '0.1.0';

function formatNextSync(next: Date | null): string {
  if (!next) return '—';
  const ms = next.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}

export function SettingsScreen({ onClose, onLogout }: Props) {
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const photoCap = useSettingsStore((s) => s.photoCap);
  const syncInterval = useSettingsStore((s) => s.syncInterval);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const setPhotoCap = useSettingsStore((s) => s.setPhotoCap);
  const setSyncInterval = useSettingsStore((s) => s.setSyncInterval);

  const retryCount = useSyncStore((s) => s.retryCount);
  const nextRetryAt = useSyncStore((s) => s.nextRetryAt);
  const deadLetterCount = useSyncStore((s) => s.deadLetterCount);
  const lastRunAt = useSyncStore((s) => s.lastRunAt);
  const lastError = useSyncStore((s) => s.lastError);

  const [urlDraft, setUrlDraft] = useState(serverUrl);
  const [tokenPrefix, setTokenPrefix] = useState('…');
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setUrlDraft(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    (async () => {
      try {
        const tok = await getDeviceToken();
        const bare = tok.startsWith('dev_') ? tok.slice(4) : tok;
        setTokenPrefix(bare.slice(0, 8));
      } catch {
        setTokenPrefix('unknown');
      }
      refreshUsage();
    })();
  }, []);

  const refreshUsage = async () => {
    setRefreshing(true);
    try {
      const u = await storageUsage();
      setUsage(u);
    } catch {
      // surface as section disabled state
    } finally {
      setRefreshing(false);
    }
  };

  const saveServer = () => {
    const trimmed = urlDraft.trim();
    if (trimmed.length === 0) {
      Alert.alert('Server URL', 'URL cannot be empty.');
      return;
    }
    setServerUrl(trimmed);
    Alert.alert('Saved', 'Server URL will be used on next sync.');
  };

  const pickInterval = async (interval: SyncInterval) => {
    setSyncInterval(interval);
    try {
      if (interval === 'manual') {
        await stopSync();
      } else {
        await startSync(interval, true, false);
      }
    } catch {
      // surface as muted state
    }
  };

  const doRetry = async () => {
    try {
      await runOnce();
      Alert.alert('Retry queued', 'A one-shot sync has been enqueued.');
    } catch (e) {
      Alert.alert('Retry failed', String(e));
    }
  };

  const doLogout = () => {
    Alert.alert(
      'Log out?',
      'This clears the device token and onboarding flag. Your photos stay on disk.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            try {
              await stopSync();
            } catch {
              // best-effort
            }
            onLogout();
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.header}>
        <PressableScale onPress={onClose} hitSlop={12}>
          <View style={styles.backRow}>
            <Icon name="ChevronLeft" size="sm" color={colors.textSecondary} />
            <Text style={styles.backLabel}>Back</Text>
          </View>
        </PressableScale>
        <Text style={styles.title}>Settings</Text>
      </View>

      {deadLetterCount > 0 && (
        <Card style={styles.dangerCard}>
          <View style={styles.dangerRow}>
            <View style={styles.dangerIconWrap}>
              <Icon name="AlertTriangle" size="md" color={colors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dangerTitle}>Sync paused</Text>
              <Text style={styles.dangerHint}>
                {deadLetterCount}× dead-lettered — Last error: {lastError ?? 'unknown'}
              </Text>
            </View>
            <Button label="Retry" variant="danger" size="sm" leadingIcon="RefreshCw" onPress={doRetry} />
          </View>
        </Card>
      )}

      <SectionLabel label="Sync" />
      <Card>
        <SegmentedControl
          segments={[
            { value: 'manual', label: 'Manual', icon: 'Power' },
            { value: '15m', label: '15m', icon: 'Clock' },
            { value: '1h', label: '1h', icon: 'Clock' },
            { value: '6h', label: '6h', icon: 'Clock' },
          ]}
          value={syncInterval}
          onChange={(v) => pickInterval(v as SyncInterval)}
        />
        <Text style={styles.hint}>
          Manual disables background sync. Intervals run on WiFi with battery awareness.
        </Text>
        <View style={styles.statusGrid}>
          <StatusRow icon="Clock" label="Last sync" value={lastRunAt ? new Date(lastRunAt).toLocaleTimeString() : 'never'} />
          <StatusRow icon="RefreshCw" label="Next sync" value={formatNextSync(nextRetryAt)} />
          {retryCount > 0 && (
            <StatusRow icon="AlertCircle" label="Retry attempt" value={`#${retryCount}`} />
          )}
        </View>
      </Card>

      <SectionLabel label="Server" />
      <Card>
        <Input
          label="Server URL"
          value={urlDraft}
          onChangeText={setUrlDraft}
          placeholder="https://..."
          leadingIcon="Server"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button label="Save" variant="primary" size="sm" leadingIcon="Check" onPress={saveServer} />
      </Card>

      <SectionLabel label="Photos" />
      <Card>
        <Text style={styles.cardTitle}>Photo cap (0 = unlimited)</Text>
        <View style={styles.stepperWrap}>
          <Stepper value={photoCap} onChange={setPhotoCap} min={0} step={1} bigStep={100} />
        </View>
        <Text style={styles.hint}>
          Photos above the cap are rejected at capture so the shard stays bounded.
        </Text>
      </Card>

      <SectionLabel label="Account" />
      <Card>
        <View style={styles.accountRow}>
          <Avatar label={tokenPrefix.slice(0, 2).toUpperCase()} size="md" />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Device token</Text>
            <Text style={styles.cardSub}>{tokenPrefix}…</Text>
          </View>
        </View>
        <Button label="Log out" variant="danger" fullWidth leadingIcon="LogOut" onPress={doLogout} />
      </Card>

      <SectionLabel label="Storage" />
      <Card>
        {usage ? (
          <View style={styles.storageRows}>
            <StorageRow icon="HardDrive" label="Photos" value={formatBytes(usage.photosBytes)} />
            <StorageRow icon="Database" label="Shard" value={formatBytes(usage.shardBytes)} />
            <StorageRow icon="Layers" label="WAL" value={formatBytes(usage.walBytes)} />
          </View>
        ) : (
          <Text style={styles.hint}>Tap refresh to compute storage usage.</Text>
        )}
        <Button
          label="Refresh"
          variant="ghost"
          size="sm"
          leadingIcon="RefreshCw"
          onPress={refreshUsage}
          disabled={refreshing}
          loading={refreshing}
        />
      </Card>

      <SectionLabel label="About" />
      <Card>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>App version</Text>
          <Text style={styles.aboutValue}>{APP_VERSION}</Text>
        </View>
        <Text style={styles.footer}>Offline-first AI · Built for the Paytm × Qdrant hackathon 2025</Text>
      </Card>
    </ScrollView>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

function StatusRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.statusRow}>
      <Icon name={icon} size="sm" color={colors.textTertiary} />
      <Text style={styles.statusRowLabel}>{label}</Text>
      <Text style={styles.statusRowValue}>{value}</Text>
    </View>
  );
}

function StorageRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.storageRow}>
      <View style={styles.storageIconWrap}>
        <Icon name={icon} size="sm" color={colors.textSecondary} />
      </View>
      <Text style={styles.storageLabel}>{label}</Text>
      <Text style={styles.storageValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing[8] },
  header: { paddingHorizontal: spacing[5], paddingTop: spacing[4], gap: spacing[2], marginBottom: spacing[4] },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  backLabel: { ...typography.bodyStrong, color: colors.textSecondary },
  title: { ...typography.display, color: colors.textPrimary, marginTop: spacing[1] },

  dangerCard: {
    marginHorizontal: spacing[5],
    marginBottom: spacing[4],
    backgroundColor: colors.dangerSubtle,
    borderColor: colors.danger,
  },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  dangerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerTitle: { ...typography.bodyStrong, color: colors.danger },
  dangerHint: { ...typography.small, color: colors.textSecondary, marginTop: 2 },

  sectionLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: spacing[5],
    marginTop: spacing[5],
    marginBottom: spacing[2],
  },

  hint: { ...typography.small, color: colors.textTertiary, marginTop: spacing[2] },
  cardTitle: { ...typography.bodyStrong, color: colors.textPrimary, marginBottom: spacing[2] },
  cardSub: { ...typography.small, color: colors.textTertiary, fontFamily: 'monospace' },

  statusGrid: { marginTop: spacing[3], gap: spacing[2] },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[1] },
  statusRowLabel: { ...typography.small, color: colors.textTertiary, flex: 1 },
  statusRowValue: { ...typography.smallStrong, color: colors.textPrimary, fontVariant: ['tabular-nums'] },

  stepperWrap: { paddingVertical: spacing[2] },

  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[3] },

  storageRows: { gap: spacing[2], marginBottom: spacing[3] },
  storageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing[3],
  },
  storageIconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storageLabel: { ...typography.small, color: colors.textSecondary, flex: 1 },
  storageValue: { ...typography.smallStrong, color: colors.textPrimary, fontVariant: ['tabular-nums'] },

  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  aboutLabel: { ...typography.small, color: colors.textTertiary },
  aboutValue: { ...typography.smallStrong, color: colors.textPrimary },
  footer: { ...typography.caption, color: colors.textTertiary, textAlign: 'center', marginTop: spacing[3] },
});
