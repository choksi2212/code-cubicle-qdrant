/**
 * Tests for src/util/uuid.ts — RFC-4122 v4 UUID generator.
 */

import { uuidv4 } from '../src/util/uuid';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('uuidv4', () => {
  it('matches the RFC-4122 v4 layout', () => {
    const id = uuidv4();
    expect(id).toMatch(UUID_RE);
  });

  it('encodes the version (4) in the high nibble of the 13th hex char', () => {
    const id = uuidv4();
    // Position of the version digit: "xxxxxxxx-xxxx-4xxx-…"
    expect(id.charAt(14)).toBe('4');
  });

  it('encodes the variant (10xx) in the high nibble of the 17th hex char', () => {
    const id = uuidv4();
    const variant = id.charAt(19).toLowerCase();
    expect(['8', '9', 'a', 'b']).toContain(variant);
  });

  it('produces unique IDs across 1000 calls', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(uuidv4());
    expect(set.size).toBe(1000);
  });

  it('produces 36-char IDs (8-4-4-4-12 + 4 dashes)', () => {
    expect(uuidv4().length).toBe(36);
  });
});
