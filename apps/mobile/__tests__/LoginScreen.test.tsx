/**
 * Tests for LoginScreen.
 *
 * Validates:
 *   - The screen renders the title, subtitle, and CTA copy.
 *   - An empty / too-short submit shows the inline error and does NOT
 *     call onSignedIn or fetch.
 *   - A valid submit POSTs to /auth/login with the device_id + token,
 *     stores the returned pair via setTokens, sets the token on the
 *     apiClient, and calls onSignedIn on 200.
 *   - A 4xx response surfaces the server-side error message inline.
 */

import React from 'react';
import { safeStringify, findPressableWithText } from './helpers/testHelpers';
import renderer, { act } from 'react-test-renderer';

jest.mock('../src/services/api', () => ({
  apiClient: {
    setToken: jest.fn(),
  },
}));

jest.mock('../src/services/tokenStore', () => ({
  setTokens: jest.fn(async () => undefined),
}));

jest.mock('../src/config', () => ({
  getDeviceId: jest.fn(async () => 'dev-test-1'),
  SYNC_API_URL: 'http://testserver',
}));

const fetchMock = jest.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => '',
  json: async () => ({
    access_token: 'access.jwt',
    refresh_token: 'refresh.jwt',
    expires_in: 900,
  }),
}));
(global as any).fetch = fetchMock;

import { LoginScreen } from '../src/screens/LoginScreen';
import { apiClient } from '../src/services/api';
import { setTokens } from '../src/services/tokenStore';

const mockedSetToken = apiClient.setToken as jest.Mock;
const mockedSetTokens = setTokens as unknown as jest.Mock;
const mockedFetch = fetchMock as jest.Mock;

beforeEach(() => {
  mockedSetToken.mockClear();
  mockedSetTokens.mockClear();
  mockedFetch.mockClear();
});

describe('LoginScreen', () => {
  it('renders the title, subtitle, input, and CTA', () => {
    const tree = renderer.create(<LoginScreen onSignedIn={() => {}} />).toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('FieldEdge');
    expect(json).toContain('Enter your device token');
    expect(json).toContain('Sign in');
    expect(json).toContain('Device token');
  });

  it('rejects a too-short token inline and does NOT call fetch', async () => {
    const onSignedIn = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LoginScreen onSignedIn={onSignedIn} />);
    });

    const input = tree.root.findByProps({ placeholder: 'Device token' });
    await act(async () => {
      input.props.onChangeText('short');
    });
    const btn = tree.root.findAllByType((require('react-native').Pressable as any))
      .find((p: any) => p.props.children?.props?.children === 'Sign in');
    expect(btn).toBeDefined();
    await act(async () => {
      btn!.props.onPress();
    });

    const json = safeStringify(tree.toJSON());
    expect(json).toContain('at least 8 characters');
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('on valid input: posts /auth/login, persists tokens, and calls onSignedIn', async () => {
    const onSignedIn = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LoginScreen onSignedIn={onSignedIn} />);
    });

    const input = tree.root.findByProps({ placeholder: 'Device token' });
    await act(async () => {
      input.props.onChangeText('valid-token-12345');
    });
    const btn = tree.root.findAllByType((require('react-native').Pressable as any))
      .find((p: any) => p.props.children?.props?.children === 'Sign in');
    await act(async () => {
      btn!.props.onPress();
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe('http://testserver/auth/login');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.device_id).toBe('dev-test-1');
    expect(body.device_token).toBe('valid-token-12345');
    expect(mockedSetTokens).toHaveBeenCalledWith({
      access: 'access.jwt',
      refresh: 'refresh.jwt',
    });
    expect(mockedSetToken).toHaveBeenCalledWith('access.jwt');
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('surfaces a server-side error message inline on 4xx', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'device_token too short',
      json: async () => ({ detail: 'device_token too short' }),
    });

    const onSignedIn = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LoginScreen onSignedIn={onSignedIn} />);
    });

    const input = tree.root.findByProps({ placeholder: 'Device token' });
    await act(async () => {
      input.props.onChangeText('whatever-length-it-doesnt-matter');
    });
    const btn = tree.root.findAllByType((require('react-native').Pressable as any))
      .find((p: any) => p.props.children?.props?.children === 'Sign in');
    await act(async () => {
      btn!.props.onPress();
    });

    expect(onSignedIn).not.toHaveBeenCalled();
    const json = safeStringify(tree.toJSON());
    expect(json).toContain('device_token');
  });
});
