/**
 * RFC-4122 UUID v4 generator backed by `crypto.getRandomValues`.
 *
 * Qdrant Cloud requires point IDs to be either an unsigned integer or a UUID;
 * ULID strings (26-char Crockford base32) are rejected as `invalid point ID`.
 *
 * `react-native-get-random-values` provides `crypto.getRandomValues` (loaded
 * as the very first import in `index.js`), so this works on Android without
 * any extra native module.
 *
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx  (8-4-4-4-12 hex)
 *   - version (4) in the high nibble of byte 6
 *   - variant (10xx) in the high nibble of byte 8
 */

export function uuidv4(): string {
  const bytes = new Uint8Array(16);
  // eslint-disable-next-line no-undef
  (globalThis as any).crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
