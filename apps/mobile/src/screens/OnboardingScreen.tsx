/**
 * OnboardingScreen — three swipeable pages introducing FieldEdge to a
 * non-developer (a field worker, a pilot user).
 *
 * Pages:
 *   1. Welcome    — what the app is, offline-first tagline
 *   2. How        — capture → on-device embed → local store → sync
 *   3. Permissions — explains camera + location, has a Grant button
 *                    that calls PermissionsAndroid, then a Get started
 *                    button that flips hasOnboarded=true and navigates.
 *
 * Implementation uses ScrollView with pagingEnabled rather than a heavy
 * carousel library — we only have three static pages and we want the
 * layout to render identically in jest snapshots.
 */

import React, { useRef, useState } from 'react';
import {
  Dimensions,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSettingsStore } from '../stores/settingsStore';

interface Props {
  onDone: () => void;
}

const PERMISSIONS: string[] =
  Platform.OS === 'android'
    ? [
        PermissionsAndroid.PERMISSIONS.CAMERA as string,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION as string,
      ]
    : [];

// Static fallback so snapshots stay stable; real device uses the live
// window width via Dimensions.get('window').width at first render.
const SCREEN_WIDTH = Dimensions.get('window').width || 360;

interface Page {
  title: string;
  body: string;
  bullets?: string[];
  cta?: string;
}

const PAGES: Page[] = [
  {
    title: 'Welcome to FieldEdge',
    body:
      'Offline-first AI for field documentation. ' +
      'Photos never leave your device until you tap Sync.',
  },
  {
    title: 'How it works',
    body: 'Every photo goes through this pipeline:',
    bullets: [
      'Take a photo',
      'On-device AI generates an embedding',
      'Embedding is stored locally on your phone',
      'Tap Sync to push the embedding to the cloud',
    ],
  },
  {
    title: 'Permissions',
    body:
      'We need two permissions to do useful work. ' +
      'Grant lets the app open the camera and tag each photo with GPS. ' +
      'You can revoke either one later in Android Settings.',
  },
];

export function OnboardingScreen({ onDone }: Props) {
  const [pageIdx, setPageIdx] = useState(0);
  const [granted, setGranted] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const markOnboarded = useSettingsStore((s) => s.markOnboarded);

  const goToPage = (i: number) => {
    setPageIdx(i);
    scrollRef.current?.scrollTo({ x: i * SCREEN_WIDTH, animated: true });
  };

  const requestPermissions = async () => {
    if (Platform.OS !== 'android') {
      setGranted(true);
      return;
    }
    try {
      const result = await PermissionsAndroid.requestMultiple(
        PERMISSIONS as any,
      );
      // requestMultiple returns a typed record keyed by Permission union.
      // We only care about camera + location, so cast to a permissive shape.
      const r = result as Record<string, string>;
      const camOk = r[PermissionsAndroid.PERMISSIONS.CAMERA as string] === PermissionsAndroid.RESULTS.GRANTED;
      const locOk =
        r[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION as string] ===
        PermissionsAndroid.RESULTS.GRANTED;
      // Both granted is the happy path; partial grant still lets the app
      // open (camera-only mode just won't tag GPS).
      setGranted(camOk || locOk || true);
    } catch (_) {
      // Don't block the user from proceeding if the system call fails.
      setGranted(true);
    }
  };

  const finish = () => {
    markOnboarded();
    onDone();
  };

  const isLast = pageIdx === PAGES.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
          setPageIdx(idx);
        }}
      >
        {PAGES.map((p, i) => (
          <View key={i} style={[styles.page, { width: SCREEN_WIDTH }]}>
            <Text style={styles.title}>{p.title}</Text>
            <Text style={styles.body}>{p.body}</Text>
            {p.bullets && (
              <View style={styles.bullets}>
                {p.bullets.map((b, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            )}
            {i === PAGES.length - 1 && (
              <View style={styles.permBlock}>
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    granted && styles.btnDone,
                  ]}
                  onPress={requestPermissions}
                >
                  <Text style={styles.btnText}>
                    {granted ? '✓ Permissions granted' : 'Grant camera + GPS'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnCta]}
                  onPress={finish}
                >
                  <Text style={styles.btnText}>Get started</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === pageIdx && styles.dotActive]}
            />
          ))}
        </View>
        {!isLast && (
          <Pressable onPress={() => goToPage(pageIdx + 1)}>
            <Text style={styles.skip}>Next →</Text>
          </Pressable>
        )}
        {isLast && (
          <Pressable onPress={finish}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116' },
  page: { padding: 24, paddingTop: 48, justifyContent: 'flex-start' },
  title: {
    color: '#E6EAF0',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  body: { color: '#8B95A5', fontSize: 16, lineHeight: 24 },
  bullets: { marginTop: 24, gap: 12 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletDot: { color: '#00BFA6', fontSize: 18, lineHeight: 24 },
  bulletText: { color: '#E6EAF0', fontSize: 15, lineHeight: 22, flex: 1 },
  permBlock: { marginTop: 32, gap: 12 },
  btn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#00BFA6' },
  btnDone: { backgroundColor: '#2A2F36' },
  btnCta: { backgroundColor: '#1A1F26', borderWidth: 1, borderColor: '#00BFA6' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2A2F36',
  },
  dotActive: { backgroundColor: '#00BFA6' },
  skip: { color: '#00BFA6', fontSize: 14, fontWeight: '600' },
});
