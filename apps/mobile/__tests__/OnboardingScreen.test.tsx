/**
 * Snapshot tests for OnboardingScreen.
 *
 * Renders the screen with a fake `onDone` and verifies the snapshot
 * locks the layout (titles, bullets, permission buttons, dot pager).
 *
 * The snapshot must be inspected and accepted on first run — don't
 * blindly regenerate on changes.
 */

import React from 'react';
import renderer from 'react-test-renderer';

jest.mock('../src/stores/settingsStore', () => ({
  useSettingsStore: (selector: any) =>
    selector({ markOnboarded: jest.fn(), hasOnboarded: false }),
}));

import { OnboardingScreen } from '../src/screens/OnboardingScreen';

describe('OnboardingScreen', () => {
  it('matches the locked layout snapshot', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('includes all three page titles and the permissions CTA copy', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Welcome to FieldEdge');
    expect(json).toContain('How it works');
    expect(json).toContain('Permissions');
    expect(json).toContain('On-device AI generates an embedding');
    expect(json).toContain('Tap Sync to push the embedding to the cloud');
    expect(json).toContain('Grant camera + GPS');
    expect(json).toContain('Get started');
  });
});
