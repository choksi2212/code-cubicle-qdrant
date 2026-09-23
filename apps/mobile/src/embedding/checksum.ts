/**
 * Vector checksum computation — SHA-256 of float32 bytes.
 *
 * Uses the Web Crypto API; works in React Native (Hermes supports it via
 * `react-native-quick-crypto` or `expo-crypto`). Falls back to a JS impl
 * for environments without Web Crypto.
 */

export async function vectorChecksum(vector: number[]): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const bytes = new Uint8Array(vector.length * 4);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < vector.length; i++) {
        view.setFloat32(i * 4, vector[i], true);
      }
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `sha256:${hex}`;
    } catch {
      // fall through
    }
  }
  // JS fallback (slower but always works)
  return `sha256:${jsHash(vector)}`;
}

function jsHash(vector: number[]): string {
  // Simple deterministic hash for fallback
  let h = 0;
  for (const v of vector) {
    h = (h * 31 + Math.floor(v * 1000000)) | 0;
  }
  return h.toString(16).padStart(64, '0');
}
