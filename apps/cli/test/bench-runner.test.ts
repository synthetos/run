/**
 * ROADMAP P1-08 bench runner: the order (lock, snapshot, browser, checklist,
 * close, restore, unlock) and the refusals, with every side effect faked.
 * bench-lock.test.ts runs the same runner against the real Python helper
 * and a real flock.
 */
import { describe, expect, it } from 'vitest';
import { EXIT, checkTargetUrl, runBench, type BenchDeps, type BenchOptions, type ChecklistItem, type HilLockOutcome } from '../src/index.ts';

const ITEMS: readonly ChecklistItem[] = [
  { id: 'BENCH-P102-1', covers: 'HIL-1.1 part', check: 'Connect an idle edge-next board.', when: '' },
  { id: 'BENCH-P104-1', covers: 'HIL-1.5', check: 'No STALE while idle.', when: 'after P1-04' },
];

const OPTIONS: BenchOptions = { url: 'https://staging.run.synthetos.com/', port: '/dev/cu.usbserial-1', hilDir: '/hil', python: ['python3'], profileDir: '/profile', runDir: '/run', items: ITEMS };

function fake(options: { lock?: HilLockOutcome | 'restore-fails'; answers?: string[]; env?: Record<string, string>; browserFails?: boolean } = {}) {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const answers = [...(options.answers ?? ['p', 'p'])];
  const lockOutcome: HilLockOutcome =
    options.lock !== undefined && options.lock !== 'restore-fails'
      ? options.lock
      : {
          ok: true,
          lock: {
            lockPath: '/tmp/tinyg-hil-cu.usbserial-1.lock',
            snapshotPath: '/run/snapshot/EN-1.json',
            restore: async () => {
              calls.push('restore');
              if (options.lock === 'restore-fails') throw new Error('restore refused');
            },
            release: async () => {
              calls.push('release');
            },
          },
        };
  const deps: BenchDeps = {
    env: options.env ?? {},
    lock: async (o) => {
      calls.push(`lock ${o.port} ${o.snapshotDir}`);
      return lockOutcome;
    },
    launchBrowser: async (o) => {
      calls.push(`browser ${o.url} ${o.profileDir}`);
      if (options.browserFails === true) throw new Error('chrome not installed');
      return { close: async () => void calls.push('close') };
    },
    ask: async (q) => {
      calls.push(`ask ${q.trim()}`);
      return answers.shift() ?? 'q';
    },
    log: () => undefined,
    writeFile: async (path, text) => void files.set(path, text),
    now: () => new Date('2026-11-01T12:00:00Z'),
  };
  return { deps, calls, files, record: () => JSON.parse(files.get('/run/record.json') ?? 'null') };
}

describe('P1-08 bench runner', () => {
  it('takes the lock (with the snapshot), opens Chrome, asks each item, then closes Chrome, restores and unlocks, in that order', async () => {
    const f = fake();
    expect(await runBench(OPTIONS, f.deps)).toBe(EXIT.ok);
    expect(f.calls.map((c) => c.split(' ')[0])).toEqual(['lock', 'browser', 'ask', 'ask', 'close', 'restore', 'release']);
    expect(f.calls[0]).toBe('lock /dev/cu.usbserial-1 /run/snapshot');
    expect(f.record()).toMatchObject({ snapshotPath: '/run/snapshot/EN-1.json', restore: 'restored', aborted: null, items: [{ id: 'BENCH-P102-1', result: 'pass' }, { id: 'BENCH-P104-1', result: 'pass' }] });
  });

  it('refuses to start if the lock is held: no browser, no restore, nothing else', async () => {
    const f = fake({ lock: { ok: false, code: 'busy', message: 'board in use: {"owner":"pytest"}' } });
    expect(await runBench(OPTIONS, f.deps)).toBe(EXIT.busy);
    expect(f.calls).toEqual(['lock /dev/cu.usbserial-1 /run/snapshot']);
    expect(f.files.size).toBe(0);
  });

  it('stops when the lock or the snapshot fails', async () => {
    const f = fake({ lock: { ok: false, code: 'error', message: 'snapshot failed' } });
    expect(await runBench(OPTIONS, f.deps)).toBe(EXIT.error);
    expect(f.calls).toHaveLength(1);
  });

  it('never runs in CI', async () => {
    const f = fake({ env: { CI: 'true' } });
    expect(await runBench(OPTIONS, f.deps)).toBe(EXIT.refused);
    expect(f.calls).toEqual([]);
  });

  it('opens only staging or the localhost bench build', async () => {
    for (const url of ['https://run.synthetos.com/', 'http://staging.run.synthetos.com/', 'https://staging.run.synthetos.com:8443/', 'https://evil.example/', 'nonsense']) {
      const f = fake();
      expect(await runBench({ ...OPTIONS, url }, f.deps), url).toBe(EXIT.refused);
      expect(f.calls).toEqual([]);
    }
    expect(checkTargetUrl('http://localhost:8793/')).toEqual({ ok: true, url: 'http://localhost:8793/' });
    expect(checkTargetUrl('http://127.0.0.1:8793/')).toMatchObject({ ok: true });
  });

  it('refuses an empty selection before taking the lock', async () => {
    const f = fake();
    expect(await runBench({ ...OPTIONS, items: [] }, f.deps)).toBe(EXIT.refused);
    expect(f.calls).toEqual([]);
  });

  it('records a failure with its note and exits 1; asks again on an unknown answer', async () => {
    const f = fake({ answers: ['x', 'f', 'saw STALE at 3 s', 's', 'not wired'] });
    expect(await runBench(OPTIONS, f.deps)).toBe(EXIT.failed);
    expect(f.record().items).toMatchObject([
      { id: 'BENCH-P102-1', result: 'fail', note: 'saw STALE at 3 s' },
      { id: 'BENCH-P104-1', result: 'skip', note: 'not wired' },
    ]);
  });

  it('quit still closes Chrome, restores and unlocks', async () => {
    const f = fake({ answers: ['q'] });
    expect(await runBench(OPTIONS, f.deps)).toBe(EXIT.ok);
    expect(f.calls.slice(-3)).toEqual(['close', 'restore', 'release']);
    expect(f.record()).toMatchObject({ aborted: 'stopped by the operator before BENCH-P102-1', items: [] });
  });

  it('restores and unlocks even when Chrome fails to start', async () => {
    const f = fake({ browserFails: true });
    expect(await runBench(OPTIONS, f.deps)).toBe(EXIT.error);
    expect(f.calls).toEqual(['lock /dev/cu.usbserial-1 /run/snapshot', 'browser https://staging.run.synthetos.com/ /profile', 'restore', 'release']);
    expect(f.record().aborted).toBe('error: chrome not installed');
  });

  it('a failed restore is an error in the record, and the lock is still released', async () => {
    const f = fake({ lock: 'restore-fails' });
    expect(await runBench(OPTIONS, f.deps)).toBe(EXIT.error);
    expect(f.calls.slice(-2)).toEqual(['restore', 'release']);
    expect(f.record().restore).toEqual({ error: 'restore refused' });
  });
});
