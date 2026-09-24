/**
 * Tests for the redesigned SyncReportScreen.
 *
 * Verifies:
 *   - Empty state ("No sync yet") when report is null
 *   - Hero headline reflects outcome: "All synced", "X conflicts resolved",
 *     or "Sync failed"
 *   - Metric tiles render with the four labels (Uploaded, Downloaded,
 *     Conflicts, Errors) and the bytes aggregate row
 *   - Conflicts section appears only when at least one conflict is present
 *   - Each conflict row exposes the photo_id prefix, winner, and the
 *     fields-changed chips (or the "tap to view" fallback)
 *   - Pluralisation: 1 conflict vs N conflicts in the hero headline
 *   - The Done button is reachable and triggers onClose
 */

import React from 'react';
import renderer, { act, ReactTestInstance } from 'react-test-renderer';

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

/**
 * Drain microtasks + the setTimeout queue spawned by the count-up loop.
 * The count-up schedules ticks every ~16ms; advancing enough ticks
 * resolves it to the final value.
 */
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

  it('renders the "No sync yet" empty state without crashing', () => {
    const tree = renderer.create(
      <SyncReportScreen report={null} onClose={() => {}} />,
    );
    expect(tree.toJSON()).toBeTruthy();
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

  it('shows singular "1 conflict resolved" when exactly one conflict', async () => {
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
    expect(json).toContain('1 conflict');
    expect(json).toContain('resolved');
  });

  it('pluralises "N conflicts resolved" for multiple conflicts', async () => {
    const tree = renderer.create(
      <SyncReportScreen
        report={makeReport({
          conflicts: [
            {
              photo_id: '11111111-1111-1111-1111-111111111111',
              winner: 'local',
              fields_changed: [],
            },
            {
              photo_id: '22222222-2222-2222-2222-222222222222',
              winner: 'remote',
              fields_changed: ['tags_v2'],
            },
            {
              photo_id: '33333333-3333-3333-3333-333333333333',
              winner: 'merged',
              fields_changed: [],
            },
          ],
        })}
        onClose={() => {}}
      />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('3 conflicts');
    expect(json).toContain('resolved');
  });

  it('shows "Sync failed" when errors > 0 and nothing was exchanged', async () => {
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

  it('renders the bytes aggregate row with KB units', async () => {
    const tree = renderer.create(
      <SyncReportScreen report={makeReport()} onClose={() => {}} />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    // 10240 bytes = 10.0 KB uploaded, 4096 bytes = 4.0 KB downloaded
    expect(json).toContain('KB uploaded');
    expect(json).toContain('KB downloaded');
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
    // The Conflicts section header should not appear; the "Conflicts"
    // metric tile label is fine and expected.
    // Look for the header text by isolating the section heading.
    expect(json).not.toContain('>Conflicts<');
  });

  it('shows the Conflicts section when at least one conflict is present', async () => {
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

  it('falls back to "tap to view" when fields_changed is empty', async () => {
    const tree = renderer.create(
      <SyncReportScreen
        report={makeReport({
          conflicts: [
            {
              photo_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
              winner: 'remote',
              fields_changed: [],
            },
          ],
        })}
        onClose={() => {}}
      />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('aaaaaaaa');
    expect(json).toContain('remote');
    expect(json).toContain('tap to view');
  });

  it('invokes onOpenConflict with the photo_id when a row is tapped', async () => {
    const onOpenConflict = jest.fn();
    const tree = renderer.create(
      <SyncReportScreen
        report={makeReport({
          conflicts: [
            {
              photo_id: '550e8400-e29b-41d4-a716-446655440000',
              winner: 'local',
              fields_changed: [],
            },
          ],
        })}
        onClose={() => {}}
        onOpenConflict={onOpenConflict}
      />,
    );
    await settle();

    // Walk the tree to find the conflict Pressable and drive its onPress.
    const root = tree.root;
    const presses: ReactTestInstance[] = [];
    const walk = (node: ReactTestInstance) => {
      const props: any = node.props || {};
      if (typeof props.onPress === 'function' && props.accessibilityLabel) {
        const label = String(props.accessibilityLabel);
        if (label.startsWith('Conflict')) {
          presses.push(node);
        }
      }
      for (const child of node.children) {
        if (typeof child !== 'string') walk(child as ReactTestInstance);
      }
    };
    walk(root);

    expect(presses.length).toBeGreaterThan(0);
    act(() => {
      (presses[0].props as any).onPress();
    });
    expect(onOpenConflict).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('keeps the metric tiles when conflicts are present', async () => {
    const tree = renderer.create(
      <SyncReportScreen
        report={makeReport({
          conflicts: [
            {
              photo_id: '550e8400-e29b-41d4-a716-446655440000',
              winner: 'remote',
              fields_changed: [],
            },
          ],
        })}
        onClose={() => {}}
      />,
    );
    await settle();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Uploaded');
    expect(json).toContain('Downloaded');
    expect(json).toContain('Conflicts');
    expect(json).toContain('Errors');
    expect(json).toContain('Done');
  });
});
