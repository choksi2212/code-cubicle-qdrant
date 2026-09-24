/**
 * LoginScreen — minimal email-less device-token login.
 *
 * Today we don't have an enterprise IdP, so the "credentials" are
 * `(device_id, device_token)` where `device_token` is any 8+ char string
 * the device remembers from setup. The server mints a real JWT pair
 * cryptographically verified on every subsequent request.
 *
 * Flow:
 *   1. User pastes / types their device token into the input.
 *   2. POST /auth/login with { device_id, device_token }.
 *   3. On 200: store both tokens via `setTokens`, set the access token
 *      on `apiClient`, navigate to the home screen.
 *   4. On error: show the message inline, leave the user on the screen
 *      so they can correct the token.
 *
 * The OIDC swap replaces step 2 with an authorization-code redirect;
 * step 3 stays the same.
 */

import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiClient } from '../services/api';
import { getDeviceId, SYNC_API_URL } from '../config';
import { setTokens } from '../services/tokenStore';

interface Props {
  onSignedIn: () => void;
}

export function LoginScreen({ onSignedIn }: Props) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    const trimmed = token.trim();
    if (trimmed.length < 8) {
      setError('Device token must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const deviceId = await getDeviceId();
      const resp = await fetch(`${SYNC_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, device_token: trimmed }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Login failed (${resp.status}): ${body.slice(0, 200)}`);
      }
      const body = await resp.json();
      if (!body.access_token || !body.refresh_token) {
        throw new Error('Login response missing token pair.');
      }
      // Persist + activate before navigating so any in-flight request
      // made by the home screen immediately sees the bearer.
      await setTokens({ access: body.access_token, refresh: body.refresh_token });
      apiClient.setToken(body.access_token);
      onSignedIn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Keep the user on the screen with their input so they can retry.
      Alert.alert('Sign-in failed', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>FieldEdge</Text>
        <Text style={styles.subtitle}>
          Enter your device token to sync with the cluster.
        </Text>

        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Device token"
          placeholderTextColor="#5B6573"
          secureTextEntry
          editable={!busy}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.btn, busy && styles.btnBusy]}
          onPress={onSubmit}
          disabled={busy}
        >
          <Text style={styles.btnText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>

        <Text style={styles.footer}>
          Tokens are stored in Android EncryptedSharedPreferences and
          refreshed automatically in the background.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E1116', justifyContent: 'center' },
  card: {
    marginHorizontal: 24,
    padding: 24,
    borderRadius: 16,
    backgroundColor: '#1A1F26',
    gap: 16,
  },
  title: { color: '#E6EAF0', fontSize: 28, fontWeight: 'bold' },
  subtitle: { color: '#8B95A5', fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: '#0E1116',
    color: '#E6EAF0',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A2F36',
  },
  error: { color: '#EF4444', fontSize: 13 },
  btn: {
    backgroundColor: '#00BFA6',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnBusy: { opacity: 0.5 },
  btnText: { color: '#003B33', fontSize: 16, fontWeight: '700' },
  footer: {
    color: '#5B6573',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },
});
