/**
 * Snapshot + content tests for the redesigned OnboardingScreen.
 *
 * Three swipeable pages, each with hero / body / actions. The snapshot
 * must be inspected and accepted on first run.
 */

import React from 'react';
import { safeStringify, findPressableWithText } from './helpers/testHelpers';
import renderer from 'react-test-renderer';

jest.mock('../src/stores/settingsStore', () => ({
  useSettingsStore: (selector: any) =>
    selector({ markOnboarded: jest.fn(), hasOnboarded: false }),
}));

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.PermissionsAndroid = {
    PERMISSIONS: { CAMERA: 'camera', ACCESS_FINE_LOCATION: 'location' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    requestMultiple: jest.fn(async () => ({
      camera: 'granted',
      'android.permission.ACCESS_FINE_LOCATION': 'granted',
    })),
  };
  return RN;
});

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
    expect(json).toContain('Grant permissions');
  });

  it('includes the four feature bullets on page 2', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('On-device AI');
    expect(json).toContain('Encrypted at rest');
    expect(json).toContain('Syncs over WiFi');
    expect(json).toContain('Search by meaning');
  });

  it('includes the four pipeline step labels on page 1', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Capture');
    expect(json).toContain('Embed');
    expect(json).toContain('Store');
    expect(json).toContain('Sync');
  });

  it('includes permission card labels', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Camera');
    expect(json).toContain('Location');
  });

  it('includes a Skip action on the first two pages', () => {
    const tree = renderer
      .create(<OnboardingScreen onDone={() => {}} />)
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Skip');
  });
});
