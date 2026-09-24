/**
 * Snapshot + content tests for OnboardingScreen.
 *
 * Locks the redesigned layout (three swipeable pages with hero / steps /
 * permissions) and asserts each page's copy is present in the rendered
 * tree. The snapshot must be inspected and accepted on first run.
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

  it('includes all three page titles', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Field intelligence, in your pocket');
    expect(json).toContain('How it works');
    expect(json).toContain('Permissions');
  });

  it('includes the four feature bullets across pages', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('On-device AI');
    expect(json).toContain('Encrypted at rest');
    expect(json).toContain('Syncs when online');
    expect(json).toContain('Searches semantically');
  });

  it('includes the CTA copy for the final page', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Get started');
    expect(json).toContain('Grant permissions');
  });

  it('includes hero icons (Camera, Sparkles, Database) for the welcome page', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('"name":"Camera"');
    expect(json).toContain('"name":"Sparkles"');
    expect(json).toContain('"name":"Database"');
  });

  it('includes the four pipeline step labels on page 2', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Capture');
    expect(json).toContain('Embed');
    expect(json).toContain('Store');
    expect(json).toContain('Sync');
  });
});
