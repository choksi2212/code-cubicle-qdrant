/**
 * Tests for src/util/logger.ts — JSON-structured log lines.
 */

import { _setLogLevel, logger, bind } from '../src/util/logger';

interface CapturedLog {
  level: 'log' | 'warn' | 'error';
  line: string;
}

function captureLogs(): { lines: CapturedLog[]; restore: () => void } {
  const lines: CapturedLog[] = [];
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = ((...args: unknown[]) => {
    lines.push({ level: 'log', line: String(args[0]) });
    return undefined;
  }) as any;
  console.warn = ((...args: unknown[]) => {
    lines.push({ level: 'warn', line: String(args[0]) });
    return undefined;
  }) as any;
  console.error = ((...args: unknown[]) => {
    lines.push({ level: 'error', line: String(args[0]) });
    return undefined;
  }) as any;
  return {
    lines,
    restore: () => {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
    },
  };
}

function parseAll(lines: CapturedLog[]): any[] {
  return lines.map((l) => JSON.parse(l.line));
}

describe('logger', () => {
  let restore: () => void;
  let lines: CapturedLog[];

  beforeEach(() => {
    const cap = captureLogs();
    lines = cap.lines;
    restore = cap.restore;
    _setLogLevel('DEBUG'); // tests run with everything visible
  });

  afterEach(() => {
    restore();
  });

  it('emits valid JSON with required fields', () => {
    logger.info('hello world', { device_id: 'dev-1', op: 'sync.upload' });
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0].line);
    expect(parsed.msg).toBe('hello world');
    expect(parsed.level).toBe('INFO');
    expect(typeof parsed.ts).toBe('string');
    expect(parsed.request_id).toBe('-');
    expect(parsed.device_id).toBe('dev-1');
    expect(parsed.op).toBe('sync.upload');
  });

  it('routes WARN to console.warn and ERROR to console.error', () => {
    logger.warn('careful');
    logger.error('boom');
    const parsed = parseAll(lines);
    expect(parsed.map((p) => p.level)).toEqual(['WARN', 'ERROR']);
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('filters out messages below the current LOG_LEVEL', () => {
    _setLogLevel('ERROR');
    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('yes');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0].line).msg).toBe('yes');
  });

  it('bind() merges supplied kv into every subsequent call', () => {
    const reqLog = bind({ request_id: 'r-1', device_id: 'dev-7' });
    reqLog.info('first', { op: 'sync.upload' });
    reqLog.warn('second', { op: 'sync.pull' });
    const parsed = parseAll(lines);
    expect(parsed[0].request_id).toBe('r-1');
    expect(parsed[0].device_id).toBe('dev-7');
    expect(parsed[0].op).toBe('sync.upload');
    expect(parsed[1].request_id).toBe('r-1');
    expect(parsed[1].op).toBe('sync.pull');
  });

  it('extras passed to a bound logger override the bound kv', () => {
    const reqLog = bind({ request_id: 'r-1', device_id: 'dev-7' });
    reqLog.info('with override', { device_id: 'dev-override' });
    const parsed = parseAll(lines);
    expect(parsed[0].request_id).toBe('r-1');
    expect(parsed[0].device_id).toBe('dev-override');
  });

  it('emits one line per call (no batching, no extra noise)', () => {
    logger.info('one');
    logger.info('two');
    logger.info('three');
    expect(lines.length).toBe(3);
    expect(parseAll(lines).map((p) => p.msg)).toEqual(['one', 'two', 'three']);
  });
});
