/**
 * Tests for FR-024 photo cap enforcement.
 *
 * Exercises the PhotoCapExceededError path in capture.ts without needing
 * the full Android device flow. Mocks the FieldEdgeRust module so the
 * cap check runs against a fake pointCount() result.
 */

import { PhotoCapExceededError } from '../src/services/capture';

// Mocks must be declared before importing the module under test.
jest.mock('../src/native/fieldEdge', () => ({
  fieldEdge: {
    pointCount: jest.fn(),
    checksum: jest.fn(async () => ({ status: 'ok', value: { checksum: 'sha256:test' } })),
    upsertPoints: jest.fn(async () => ({ upserted: 1 })),
    walAppend: jest.fn(async () => ({ seq: 1 })),
  },
}));

jest.mock('../src/config', () => ({
  getPhotoCap: jest.fn(),
  WAL_PATH: '/tmp/wal',
  photoDir: () => '/tmp/photos',
  photoAbsPath: () => '/tmp/photos/x.jpg',
  relativePhotoPath: () => 'x.jpg',
  getDeviceId: async () => 'dev_test',
}));

jest.mock('../src/embedding/clip', () => ({
  embedImage: jest.fn(async () => new Array(512).fill(0.1)),
}));

jest.mock('../src/services/location', () => ({
  captureGps: jest.fn(async () => ({ coords: null, source: 'none' })),
}));

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/tmp/docs',
    mkdir: jest.fn(async () => undefined),
    copyFile: jest.fn(async () => undefined),
  },
}));

// Import after mocks so the mocks take effect.
import { fieldEdge } from '../src/native/fieldEdge';
import { getPhotoCap } from '../src/config';
import { processCapture } from '../src/services/capture';

const mockedFieldEdge = fieldEdge as jest.Mocked<typeof fieldEdge>;
const mockedGetPhotoCap = getPhotoCap as jest.Mock;

describe('FR-024 photo cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws PhotoCapExceededError when currentCount >= cap', async () => {
    mockedGetPhotoCap.mockReturnValue(5);
    mockedFieldEdge.pointCount.mockResolvedValue(5);

    await expect(
      processCapture({ photoUri: 'file:///tmp/test.jpg', width: 100, height: 100 }),
    ).rejects.toThrow(PhotoCapExceededError);

    // pointCount was consulted, but no upsert happened (we never got that far).
    expect(mockedFieldEdge.pointCount).toHaveBeenCalledTimes(1);
  });

  it('passes through when currentCount < cap', async () => {
    mockedGetPhotoCap.mockReturnValue(10);
    mockedFieldEdge.pointCount.mockResolvedValue(4);

    const result = await processCapture({
      photoUri: 'file:///tmp/test.jpg',
      width: 100,
      height: 100,
    });
    expect(result.photoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.embeddingStatus).toBe('ok');
  });

  it('skips the cap check when cap is 0 (disabled)', async () => {
    mockedGetPhotoCap.mockReturnValue(0);
    // pointCount should NOT be called when cap is 0.

    const result = await processCapture({
      photoUri: 'file:///tmp/test.jpg',
      width: 100,
      height: 100,
    });
    expect(result.photoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockedFieldEdge.pointCount).not.toHaveBeenCalled();
  });

  it('error message includes current count and cap', async () => {
    mockedGetPhotoCap.mockReturnValue(5);
    mockedFieldEdge.pointCount.mockResolvedValue(7);

    try {
      await processCapture({ photoUri: 'file:///tmp/test.jpg', width: 100, height: 100 });
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(PhotoCapExceededError);
      expect(e.current).toBe(7);
      expect(e.cap).toBe(5);
      expect(e.message).toContain('7');
      expect(e.message).toContain('5');
    }
  });
});
