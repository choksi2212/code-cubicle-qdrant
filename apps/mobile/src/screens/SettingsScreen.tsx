/**
 * SettingsScreen — gear-icon screen exposed from the Home header.
 *
 * Sections:
 *   - Sync           (interval chips Manual/15m/1h/6h, last attempt, next scheduled,
 *                     Retry now button when dead-lettered)
 *   - Server URL     (text input, persisted to settings store)
 *   - Photo cap      (number stepper; 0 = unlimited)
 *   - Account        (device token prefix + Logout button — clears local
 *                     device token + onboarding flag; no server-side
 *                     session exists yet, so logout is local-only)
 *   - Storage usage  (photos / shard / WAL bytes; Refresh button)
 *   - About          (app version + hackathon credit)
 *
 * All persistence flows through the settings store (zustand + AsyncStorage).
 * The Sync section also calls into `syncScheduler.ts` which talks to
 * the Android `SyncSchedulerModule` (WorkManager).
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSettingsStore, SyncInterval } from '../stores/settingsStore';
import { useSyncStore } from '../stores/syncStore';
import { formatBytes, storageUsage, StorageUsage } from '../storage/storageUsage';
import { getDeviceToken } from '../config';
import { startSync, stopSync, runOnce, getStatus } from '../services/syncScheduler';

interface Props {
  onClose: () => void;
  onLogout: () => void;
}

const APP_VERSION = '0.1.0';

const INTERVAL_CHIPS: Array<{ key: SyncInterval; label: string }> = [
  { key: 'manual', label: 'Manual' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
];

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
  const lastReport = useSyncStore((s) => s.lastReport);

  const [urlDraft, setUrlDraft] = useState(serverUrl);
  const [tokenPrefix, setTokenPrefix] = useState('…');
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);

  useEffect(() => {
    setUrlDraft(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    (async () => {
      try {
        const tok = await getDeviceToken();
        // dev_<id> → strip prefix, show first 8 chars
        const bare = tok.startsWith('dev_') ? tok.slice(4) : tok;
        setTokenPrefix(bare.slice(0, 8) + '…');
      } catch (_) {
        setTokenPrefix('unknown');
      }
      refreshUsage();
      // Pull WorkManager's persisted schedule for the "next scheduled" line
      try {
        const status = await getStatus();
        setScheduledAt(status?.lastRunAt ?? null);
      } catch (_) {
        // Module not present (jest env) — leave as null.
      }
    })();
  }, []);

  const refreshUsage = async () => {
    setRefreshing(true);
    try {
      const u = await storageUsage();
      setUsage(u);
    } catch (e) {
      console.warn('storageUsage failed:', e);
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

  const saveCap = (n: number) => {
    if (!Number.isFinite(n) || n < 0) {
      Alert.alert('Photo cap', 'Must be 0 (unlimited) or a positive number.');
      return;
    }
    setPhotoCap(n);
  };

  const pickInterval = async (interval: SyncInterval) => {
    setSyncInterval(interval);
    try {
      if (interval === 'manual') {
        await stopSync();
      } else {
        // Default to wifi-only + no-charging constraint — fits field-worker
        // pattern where the device is rarely on a metered network but
        // battery may be low.
        await startSync(interval, true, false);
      }
    } catch (e) {
      console.warn('[SettingsScreen] startSync failed:', e);
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
            } catch (_) {
              // Best-effort — even if WorkManager cancel fails we proceed.
            }
            onLogout();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Settings</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* ─── Sync ──────────────────────────────────────────────────── */}
        <Section label="Sync">
          <View style={styles.chipRow}>
            {INTERVAL_CHIPS.map((chip) => {
              const active = syncInterval === chip.key;
              return (
                <Pressable
                  key={chip.key}
                  onPress={() => pickInterval(chip.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {deadLetterCount > 0 ? (
            <View style={styles.deadLetter}>
              <Text style={styles.deadLetterTitle}>
                Sync paused ({deadLetterCount}× dead-lettered)
              </Text>
              <Text style={styles.deadLetterHint}>
                Last error: {lastError ?? 'unknown'}
              </Text>
              <Pressable style={styles.btnRetry} onPress={doRetry}>
                <Text style={styles.btnRetryText}>Retry now</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Row
                label="Last sync"
                value={
                  lastRunAt
                    ? lastRunAt.toLocaleTimeString()
                    : 'never'
                }
              />
              <Row
                label="Next sync"
                value={formatNextSync(nextRetryAt)}
              />
              {retryCount > 0 ? (
                <Text style={styles.retryHint}>
                  Retry attempt {retryCount} of 7
                </Text>
              ) : null}
              {lastReport && lastReport.errors > 0 ? (
                <Text style={styles.retryHint}>
                  Last run had {lastReport.errors} errors
                </Text>
              ) : null}
            </>
          )}
        </Section>

        {/* ─── Server URL ──────────────────────────────────────────────── */}
        <Section label="Server URL">
          <TextInput
            style={styles.input}
            value={urlDraft}
            onChangeText={setUrlDraft}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://…"
            placeholderTextColor="#5B6573"
          />
          <Pressable style={styles.btnSave} onPress={saveServer}>
            <Text style={styles.btnSaveText}>Save</Text>
          </Pressable>
        </Section>

        {/* ─── Photo cap ────────────────────────────────────────────────── */}
        <Section label="Photo cap (0 = unlimited)">
          <View style={styles.stepper}>
            <Pressable
              style={styles.stepperBtn}
              onPress={() => saveCap(Math.max(0, photoCap - 100))}
            >
              <Text style={styles.stepperBtnText}>−100</Text>
            </Pressable>
            <Pressable
              style={styles.stepperBtn}
              onPress={() => saveCap(Math.max(0, photoCap - 1))}
            >
              <Text style={styles.stepperBtnText}>−1</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{photoCap}</Text>
            <Pressable
              style={styles.stepperBtn}
              onPress={() => saveCap(photoCap + 1)}
            >
              <Text style={styles.stepperBtnText}>+1</Text>
            </Pressable>
            <Pressable
              style={styles.stepperBtn}
              onPress={() => saveCap(photoCap + 100)}
            >
              <Text style={styles.stepperBtnText}>+100</Text>
            </Pressable>
          </View>
        </Section>

        {/* ─── Account ─────────────────────────────────────────────────── */}
        <Section label="Account">
          <Row label="Device token" value={tokenPrefix} />
          <Pressable style={styles.btnDanger} onPress={doLogout}>
            <Text style={styles.btnDangerText}>Log out</Text>
          </Pressable>
        </Section>

        {/* ─── Storage usage ───────────────────────────────────────────── */}
        <Section label="Storage usage">
          {usage ? (
            <View>
              <Row label="Photos" value={formatBytes(usage.photosBytes)} />
              <Row label="Shard" value={formatBytes(usage.shardBytes)} />
              <Row label="WAL" value={formatBytes(usage.walBytes)} />
            </View>
          ) : (
            <Text style={styles.hint}>Loading…</Text>
          )}
          <Pressable
            style={[styles.btnSave, refreshing && styles.btnBusy]}
            onPress={refreshUsage}
            disabled={refreshing}
          >
            <Text style={styles.btnSaveText}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Text>
          </Pressable>
        </Section>

        {/* ─── About ───────────────────────────────────────────────────── */}
        <Section label="About">
          <Row label="App version" value={APP_VERSION} />
          <Text style={styles.footer}>
            Built for Paytm × Qdrant hackathon
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116' },
  scroll: { paddingBottom: 48 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 8,
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  backText: { color: '#00BFA6', fontSize: 14, fontWeight: '600' },
  title: { color: '#E6EAF0', fontSize: 22, fontWeight: 'bold' },
  section: { marginTop: 16, paddingHorizontal: 16 },
  sectionLabel: {
    color: '#8B95A5',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  sectionBody: {
    backgroundColor: '#1A1F26',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  input: {
    backgroundColor: '#0E1116',
    color: '#E6EAF0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#2A2F36',
  },
  btnSave: {
    backgroundColor: '#00BFA6',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnSaveText: { color: '#003B33', fontSize: 14, fontWeight: '700' },
  btnBusy: { opacity: 0.5 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepperBtn: {
    backgroundColor: '#2A2F36',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  stepperBtnText: { color: '#E6EAF0', fontSize: 14, fontWeight: '600' },
  stepperValue: {
    color: '#E6EAF0',
    fontSize: 22,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#2A2F36',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2A2F36',
  },
  chipActive: {
    backgroundColor: '#003B33',
    borderColor: '#00BFA6',
  },
  chipText: { color: '#8B95A5', fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#00BFA6' },
  retryHint: { color: '#F5A524', fontSize: 12, fontStyle: 'italic' },
  deadLetter: {
    backgroundColor: '#2A1A1F',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
    gap: 6,
  },
  deadLetterTitle: { color: '#EF4444', fontSize: 14, fontWeight: '700' },
  deadLetterHint: { color: '#FCA5A5', fontSize: 12 },
  btnRetry: {
    backgroundColor: '#EF4444',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  btnRetryText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  hint: { color: '#5B6573', fontSize: 12, fontStyle: 'italic' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rowLabel: { color: '#8B95A5', fontSize: 14 },
  rowValue: { color: '#E6EAF0', fontSize: 14, fontWeight: '600' },
  btnDanger: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2A1A1F',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  btnDangerText: { color: '#EF4444', fontSize: 14, fontWeight: '700' },
  footer: {
    color: '#5B6573',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
});
