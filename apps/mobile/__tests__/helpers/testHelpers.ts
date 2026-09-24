/**
 * Test helpers shared across screen unit tests.
 *
 * `safeStringify` — JSON.stringify with circular-ref + function guards.
 * react-test-renderer's toJSON() returns an object tree containing
 * React-element props (with `_owner` back-references to the parent fiber)
 * and function props. Plain JSON.stringify throws "Converting circular
 * structure to JSON" or returns undefined when handed these.
 *
 * `findPressable` / `findPressableWithText` — walk the TestInstance tree
 * (without stringifying) to locate the host Pressable whose subtree
 * contains a target substring or whose accessibilityLabel matches. These
 * are how the legacy walk-based tests find the back button, conflict
 * rows, photo cells, etc. without tripping the circular-ref bug above.
 */

const REACT_INTERNAL_KEYS = new Set(['_owner', '_store', '$$typeof']);

export function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    if (typeof val === 'function') return undefined;
    if (key && REACT_INTERNAL_KEYS.has(key)) return undefined;
    if (val && typeof val === 'object') {
      if (seen.has(val as object)) return undefined;
      seen.add(val as object);
    }
    return val;
  });
}

function subtreeHasString(node: any, target: string): boolean {
  if (node == null) return false;
  if (typeof node === 'string') return node === target;
  const kids = node.children || [];
  for (const k of kids) {
    if (subtreeHasString(k, target)) return true;
  }
  return false;
}

export function findPressableWithText(root: any, text: string): any | null {
  const walk = (node: any): any | null => {
    if (!node) return null;
    if (node.type === 'Pressable' && typeof node.props?.onPress === 'function') {
      // Match either a visible string in the subtree OR the same text in
      // an accessibilityLabel (cells/rows expose identity only via a11y).
      if (
        subtreeHasString(node, text) ||
        (typeof node.props.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.includes(text))
      ) {
        return node;
      }
    }
    const kids = node.children || [];
    for (const k of kids) {
      if (k && typeof k === 'object') {
        const found = walk(k);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root);
}

export function findPressableByLabel(root: any, label: string): any | null {
  const walk = (node: any): any | null => {
    if (!node) return null;
    if (
      node.type === 'Pressable' &&
      typeof node.props?.onPress === 'function' &&
      node.props?.accessibilityLabel === label
    ) {
      return node;
    }
    const kids = node.children || [];
    for (const k of kids) {
      if (k && typeof k === 'object') {
        const found = walk(k);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root);
}
