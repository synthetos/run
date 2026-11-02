/**
 * ROADMAP P1-08 acceptance: "The bench runner refuses to start if the lock is
 * held". The real helper (src/bench/hil_lock_helper.py) and a real flock on
 * /tmp/tinyg-hil-<port>.lock, with a test double of the tinyg_hil package
 * (fixtures/fake_hil: the same lock, and a main() that records its calls).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, acquireHilLock, runBench, type HilLockOptions } from '../src/index.ts';

const PYTHON = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import fcntl'], { stdio: 'ignore' }).status === 0);
const HIL_DIR = fileURLToPath(new URL('./fixtures/fake_hil', import.meta.url));

let n = 0;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanup.splice(0)) c();
});

function setup(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'run-cli-bench-'));
  const port = `/dev/run-cli-test-${process.pid}-${n++}`;
  const lockFile = `/tmp/tinyg-hil-${port.split('/').at(-1)}.lock`;
  const calls = join(dir, 'calls.txt');
  cleanup.push(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(lockFile, { force: true });
  });
  const log: string[] = [];
  const options: HilLockOptions = {
    python: [PYTHON as string],
    hilDir: HIL_DIR,
    port,
    snapshotDir: join(dir, 'snapshot'),
    log: (l) => log.push(l),
    env: { ...process.env, FAKE_HIL_CALLS: calls, PYTHONDONTWRITEBYTECODE: '1', ...env },
  };
  const readCalls = (): string[] => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []);
  return { dir, port, lockFile, options, log, readCalls };
}

/** Another process holding the board lock (pytest, a flash), until killed. */
async function holdLock(port: string): Promise<ChildProcess> {
  const child = spawn(PYTHON as string, ['-c', 'import sys; from tinyg_hil.lock import BoardLock; BoardLock(sys.argv[1]).acquire("pytest", wait=0); print("held", flush=True); sys.stdin.read()', port], {
    cwd: HIL_DIR,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout?.once('data', () => resolve());
    child.once('exit', () => reject(new Error('the holder exited')));
  });
  cleanup.unshift(() => child.kill());
  return child;
}

/** True when another process can take the lock now (so it was released). */
function lockIsFree(port: string): boolean {
  return spawnSync(PYTHON as string, ['-c', 'import sys; from tinyg_hil.lock import BoardLock; BoardLock(sys.argv[1]).acquire("probe", wait=0).release()', port], { cwd: HIL_DIR, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).status === 0;
}

describe.skipIf(PYTHON === undefined)('P1-08 bench runner and the EN-HIL board lock (real flock)', () => {
  it('holds the lock from before the snapshot until release, runs snapshot and restore inside it', async () => {
    const s = setup();
    const out = await acquireHilLock(s.options);
    if (!out.ok) throw new Error(out.message);
    expect(out.lock.lockPath).toBe(s.lockFile);
    expect(readdirSync(join(s.dir, 'snapshot'))).toEqual(['FAKE-450.01-20261101T000000Z.json']);
    expect(out.lock.snapshotPath).toBe(join(s.dir, 'snapshot', 'FAKE-450.01-20261101T000000Z.json'));
    expect(lockIsFree(s.port)).toBe(false);
    await out.lock.restore();
    expect(lockIsFree(s.port)).toBe(false);
    await out.lock.release();
    expect(lockIsFree(s.port)).toBe(true);
    expect(s.readCalls()).toEqual([`snapshot --port ${s.port} --out ${join(s.dir, 'snapshot')}`, `restore ${out.lock.snapshotPath} --port ${s.port}`]);
    // tinyg_hil's own output reached the log, not the protocol.
    expect(s.log).toContain('board: fake');
  });

  it('refuses to restore one board\'s snapshot into another board on the same port path', async () => {
    const s = setup();
    const board = join(s.dir, 'board.json');
    s.options.env!['FAKE_HIL_BOARD_FILE'] = board;
    const out = await acquireHilLock(s.options);
    if (!out.ok) throw new Error(out.message);
    // The EN board is swapped for a stock 440.21 on the same /dev path.
    writeFileSync(board, JSON.stringify({ id: 'TG-OTHER', fb: 440.21 }));
    await expect(out.lock.restore()).rejects.toThrow(/restore refused: the board on this port reports id 'TG-OTHER', but the snapshot is from id 'FAKE'/);
    writeFileSync(board, JSON.stringify({ fb: 449.01 }));
    await expect(out.lock.restore()).rejects.toThrow(/restore refused: .*fb 449\.01/);
    await out.lock.release();
    expect(s.readCalls().filter((c) => c.startsWith('restore'))).toEqual([]);
  });

  it.each([
    ['held', { stat: 6, hold: 4 }, /not idle \(stat 6\)/],
    ['moving', { stat: 5, vel: 120 }, /not idle \(stat 5\)/],
    ['in a hold at stat 1', { hold: 2 }, /feedhold \(hold 2\)/],
    ['with queued moves', { qr: 20 }, /planner is not empty \(qr 20, 32 when the run started\)/],
  ])('refuses to restore to a board that is %s', async (_label, state, message) => {
    const s = setup();
    const board = join(s.dir, 'board.json');
    s.options.env!['FAKE_HIL_BOARD_FILE'] = board;
    const out = await acquireHilLock(s.options);
    if (!out.ok) throw new Error(out.message);
    writeFileSync(board, JSON.stringify(state));
    await expect(out.lock.restore()).rejects.toThrow(message);
    await out.lock.release();
    expect(s.readCalls().filter((c) => c.startsWith('restore'))).toEqual([]);
  });

  it('refuses to snapshot (which sends G21) a board that is not idle: nothing is written', async () => {
    const s = setup();
    const board = join(s.dir, 'board.json');
    writeFileSync(board, JSON.stringify({ stat: 5, vel: 80 }));
    const out = await acquireHilLock({ ...s.options, env: { ...s.options.env, FAKE_HIL_BOARD_FILE: board } });
    expect(out).toMatchObject({ ok: false, code: 'error' });
    expect(out.ok ? '' : out.message).toMatch(/refusing to snapshot: the board is not idle \(stat 5\)/);
    expect(s.readCalls()).toEqual([]);
    expect(lockIsFree(s.port)).toBe(true);
  });

  it('refuses at once when the lock is held: busy, with the holder, and tinyg_hil is never run', async () => {
    const s = setup();
    await holdLock(s.port);
    const out = await acquireHilLock(s.options);
    expect(out).toMatchObject({ ok: false, code: 'busy' });
    expect(out.ok ? '' : out.message).toMatch(/board in use: .*"purpose": "pytest"/);
    expect(s.readCalls()).toEqual([]);
    expect(existsSync(join(s.dir, 'snapshot'))).toBe(false);
  });

  it('the runner refuses to start if the lock is held: exit 3, no browser, no snapshot, no restore', async () => {
    const s = setup();
    await holdLock(s.port);
    const launched: string[] = [];
    const code = await runBench(
      { url: 'https://staging.run.synthetos.com/', port: s.port, hilDir: HIL_DIR, python: s.options.python, profileDir: '/p', runDir: s.dir, items: [{ id: 'BENCH-P1-1', covers: '', check: 'check', when: '' }] },
      {
        env: { FAKE_HIL_CALLS: join(s.dir, 'calls.txt') },
        lock: (o) => acquireHilLock({ ...o, ...(s.options.env === undefined ? {} : { env: s.options.env }) }),
        launchBrowser: async (o) => {
          launched.push(o.url);
          return { close: async () => undefined };
        },
        ask: async () => 'p',
        log: () => undefined,
        writeFile: async () => undefined,
        now: () => new Date(),
      },
    );
    expect(code).toBe(EXIT.busy);
    expect(launched).toEqual([]);
    expect(s.readCalls()).toEqual([]);
  });

  it('a failed snapshot releases the lock and is an error', async () => {
    const s = setup({ FAKE_HIL_FAIL: 'snapshot' });
    const out = await acquireHilLock(s.options);
    expect(out).toMatchObject({ ok: false, code: 'error' });
    expect(out.ok ? '' : out.message).toMatch(/snapshot failed: RuntimeError: no answer from the board/);
    expect(lockIsFree(s.port)).toBe(true);
  });

  it('a failed restore rejects, and release still frees the lock', async () => {
    const s = setup({ FAKE_HIL_FAIL: 'restore' });
    const out = await acquireHilLock(s.options);
    if (!out.ok) throw new Error(out.message);
    await expect(out.lock.restore()).rejects.toThrow(/restore failed: RuntimeError: restore refused/);
    await out.lock.release();
    expect(lockIsFree(s.port)).toBe(true);
  });

  it('the lock goes with the runner: closing the helper\'s input releases it', async () => {
    const s = setup();
    const out = await acquireHilLock(s.options);
    if (!out.ok) throw new Error(out.message);
    await out.lock.release();
    await out.lock.release();
    expect(lockIsFree(s.port)).toBe(true);
    await expect(out.lock.restore()).rejects.toThrow(/already released/);
  });

  it('reports a Python that cannot start', async () => {
    const s = setup();
    expect(await acquireHilLock({ ...s.options, python: ['/nonexistent/python'] })).toMatchObject({ ok: false, code: 'error' });
    expect(await acquireHilLock({ ...s.options, python: [] })).toEqual({ ok: false, code: 'error', message: 'no Python command' });
  });
});
