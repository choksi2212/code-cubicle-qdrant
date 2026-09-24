/**
 * Tests for the storage usage accounting module.
 *
 * Mocks RNFS to return a synthetic tree under <docs> and <shard_dir>.
 * Asserts that:
 *   - photo sizes are summed across <project>/<device>/*.jpg
 *   - shard files are summed recursively
 *   - WAL size comes from RNFS.stat
 *   - missing directories count as 0
 *   - formatBytes produces sensible strings
 */

type RNFSReadDirItem = {
  name: string;
  path: string;
  isFile: () => boolean;
  isDirectory: () => boolean;
  size: number;
};

// Build a virtual FS keyed by directory path.
const mockFS: Record<string, RNFSReadDirItem[]> = {
  '/docs': [
    mkDir('/docs/river-study'),
    mkDir('/docs/forest-survey'),
  ],
  '/docs/river-study': [mkDir('/docs/river-study/dev_1')],
  '/docs/river-study/dev_1': [
    mkFile('/docs/river-study/dev_1/a.jpg', 200),
    mkFile('/docs/river-study/dev_1/b.jpg', 300),
    mkDir('/docs/river-study/dev_1/sub'),
  ],
  '/docs/river-study/dev_1/sub': [
    mkFile('/docs/river-study/dev_1/sub/c.jpg', 50),
  ],
  '/docs/forest-survey': [mkDir('/docs/forest-survey/dev_2')],
  '/docs/forest-survey/dev_2': [
    mkFile('/docs/forest-survey/dev_2/x.jpg', 1024),
  ],
  '/shard': [
    mkFile('/shard/index.bin', 4000),
    mkDir('/shard/data'),
  ],
  '/shard/data': [
    mkFile('/shard/data/p1.bin', 6000),
  ],
};

function mkFile(path: string, size: number): RNFSReadDirItem {
  return {
    name: path.split('/').pop() ?? '',
    path,
    isFile: () => true,
    isDirectory: () => false,
    size,
  };
}
function mkDir(path: string): RNFSReadDirItem {
  return {
    name: path.split('/').pop() ?? '',
    path,
    isFile: () => false,
    isDirectory: () => true,
    size: 0,
  };
}

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/docs',
    readDir: jest.fn(async (path: string) => {
      if (path in mockFS) return mockFS[path];
      throw new Error('ENOENT');
    }),
    stat: jest.fn(async (_path: string) => ({ size: 4096 })),
  },
}));

jest.mock('../src/config', () => ({
  FIELD_SHARD_DIR: '/shard',
  WAL_PATH: '/shard/sync.wal',
}));

import { storageUsage, formatBytes } from '../src/storage/storageUsage';

describe('storageUsage()', () => {
  it('sums photo bytes across projects and devices', async () => {
    const u = await storageUsage();
    // 200 + 300 (river-study/dev_1) + 1024 (forest-survey/dev_2) + 50 (sub/c.jpg)
    // dirSize walks recursively, so the sub/ file is included.
    expect(u.photosBytes).toBe(1574);
  });

  it('sums shard bytes recursively', async () => {
    const u = await storageUsage();
    // 4000 (index.bin) + 6000 (data/p1.bin) = 10000
    expect(u.shardBytes).toBe(10000);
  });

  it('reports WAL size from RNFS.stat', async () => {
    const u = await storageUsage();
    expect(u.walBytes).toBe(4096);
  });

  it('returns 0 for missing directories instead of throwing', async () => {
    const RNFS = require('react-native-fs').default;
    RNFS.readDir.mockImplementation(async () => {
      throw new Error('ENOENT');
    });
    RNFS.stat.mockImplementation(async () => {
      throw new Error('ENOENT');
    });
    const u = await storageUsage();
    expect(u.photosBytes).toBe(0);
    expect(u.shardBytes).toBe(0);
    expect(u.walBytes).toBe(0);
  });

  it('formatBytes produces human-readable strings', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});
