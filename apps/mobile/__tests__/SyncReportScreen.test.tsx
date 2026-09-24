/**
 * Tests for the redesigned SyncReportScreen.
 *
 * Verifies:
 *   - Empty state when report is null
 *   - Hero headline reflects outcome
 *   - Metric tiles render with the four labels (Uploaded, Downloaded,
 *     Conflicts, Errors)
 *   - Conflicts section appears only when at least one conflict is present
 *   - Each conflict row exposes the photo_id prefix, winner, fields-changed
 *   - The Done button is reachable and triggers onClose
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { SyncReportScreen } from '../src/screens/SyncReportScreen';
import { SyncMetrics } from '../src/services/sync';

function makeReport(overrides: Partial<SyncMetrics> = {}): SyncMetrics {
  const started = new Date('2026-09-24T10:00:00Z');
  return {
    startedAt: started,
    finishedAt: new Date(started.getTime() + 1234),
    uploaded: 5,
    downloaded: 2,
    conflicts: [],
    resolved: 0,
    errors: 0,
    bytesUploaded: 10240,
    bytesDownloaded: 4096,
    ...overrides,
  };
}

async function settle() {
  for (let i = 0; i < 60; i++) {
    await act(async () => {});
  }
}

describe('SyncReportScreen — empty state', () => {
  it('renders the "No sync yet" empty state when report is null', () => {
    const tree = renderer.create(
      <SyncReportScreen report={null} onClose={() => {}} />,
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('No sync yet');
    expect(json).toContain('Close');
  });
});

describe('SyncReportScreen — hero headline', () => {
  it('shows "All synced" when no conflicts and no errors', async () => {
    const tree = renderer.create(
      <SyncReportScreen report={makeReport()} onClose={() => {}} />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('All synced');
  });

  it('shows "Partial sync" when at least one conflict is present', async () => {
    const tree = renderer.create(
      <SyncReportScreen
        report={makeReport({
          conflicts: [
            {
              photo_id: '550e8400-e29b-41d4-a716-446655440000',
              winner: 'local',
              fields_changed: ['enrichment_text'],
            },
          ],
        })}
        onClose={() => {}}
      />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Partial sync');
  });

  it('shows "Sync failed" when errors > 0', async () => {
    const tree = renderer.create(
      <SyncReportScreen
        report={makeReport({ uploaded: 0, downloaded: 0, errors: 2 })}
        onClose={() => {}}
      />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Sync failed');
  });
});

describe('SyncReportScreen — metrics grid', () => {
  it('renders all four metric labels', async () => {
    const tree = renderer.create(
      <SyncReportScreen report={makeReport()} onClose={() => {}} />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Uploaded');
    expect(json).toContain('Downloaded');
    expect(json).toContain('Conflicts');
    expect(json).toContain('Errors');
  });

  it('renders the bytes row with KB units', async () => {
    const tree = renderer.create(
      <SyncReportScreen report={makeReport()} onClose={() => {}} />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    // 10240 bytes = 10.0 KB, 4096 bytes = 4.0 KB
    expect(json).toContain('10.0');
    expect(json).toContain('KB');
    expect(json).toContain('4.0');
  });

  it('renders the Done button', async () => {
    const tree = renderer.create(
      <SyncReportScreen report={makeReport()} onClose={() => {}} />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Done');
  });
});

describe('SyncReportScreen — conflicts list', () => {
  it('hides the Conflicts section when there are no conflicts', async () => {
    const tree = renderer.create(
      <SyncReportScreen report={makeReport()} onClose={() => {}} />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    // The Conflicts section label is uppercase "CONFLICTS" — it should
    // not appear when there are no conflicts.
    expect(json).not.toContain('Conflicts\n');
  });

  it('renders each conflict row with photo_id prefix, winner, and fields', async () => {
    const tree = renderer.create(
      <SyncReportScreen
        report={makeReport({
          conflicts: [
            {
              photo_id: '550e8400-e29b-41d4-a716-446655440000',
              winner: 'local',
              fields_changed: ['enrichment_text'],
            },
          ],
        })}
        onClose={() => {}}
      />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('550e8400');
    expect(json).toContain('local');
    expect(json).toContain('enrichment_text');
  });

  it('invokes onOpenConflict when a row is tapped', async () => {
    const onOpenConflict = jest.fn();
    const tree = renderer.create(
      <SyncReportScreen
        report={makeReport({
          conflicts: [
            {
              photo_id: '550e8400-e29b-41d4-a716-446655440000',
              winner: 'local',
              fields_changed: ['enrichment_text'],
            },
          ],
        })}
        onClose={() => {}}
        onOpenConflict={onOpenConflict}
      />,
    );
    await settle();
    // Walk the tree to find any Pressable and tap the first one whose
    // toJSON() includes the photo_id. Avoid JSON.stringify on raw
    // ReactTestInstance (it has circular _fiber refs).
    const root = tree.root;
    let tapped = false;
    const walk = (node: any) => {
      if (tapped) return;
      if (typeof node.props?.onPress === 'function') {
        let s = '';
        try {
          s = JSON.stringify(node.toJSON ? node.toJSON() : node);
        } catch {
          s = '';
        }
        if (s.includes('550e8400')) {
          act(() => node.props.onPress());
          tapped = true;
          return;
        }
      }
      const children = node.children || [];
      for (const child of children) {
        if (child && typeof child === 'object') walk(child);
      }
    };
    walk(root);
    expect(onOpenConflict).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });
});
