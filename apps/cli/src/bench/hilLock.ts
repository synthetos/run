/**
 * The EN-HIL board lock, held for the whole bench run (ROADMAP P1-08,
 * SAFETY §9: "takes the EN-HIL port lock `/tmp/tinyg-hil-<port>.lock`").
 *
 * The lock is EN-HIL's own `tinyg_hil.lock.BoardLock` (an flock), taken by
 * hil_lock_helper.py, a Python process that lives as long as the run. Node
 * has no flock; a helper process also means the lock goes away with the
 * runner, however it ends. The helper takes the lock without waiting: a
 * held lock refuses the run before anything touches the board. Inside the
 * lock it runs `python -m tinyg_hil snapshot`, and `restore` on request.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

export const HELPER_PATH = fileURLToPath(new URL('./hil_lock_helper.py', import.meta.url));
const PREFIX = '@@bench ';

export interface HilLockOptions {
  /** The Python command, e.g. ['uv', 'run', 'python'] or ['python3']. */
  readonly python: readonly string[];
  /** The EN-HIL directory (edge-next tests/hil): the helper imports tinyg_hil from there. */
  readonly hilDir: string;
  /** The serial port path (`/dev/cu.usbserial-…`). */
  readonly port: string;
  /** An empty directory for the settings snapshot. */
  readonly snapshotDir: string;
  /** Where tinyg_hil's own output goes. */
  readonly log: (line: string) => void;
  /** For tests. */
  readonly helperPath?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface HilLock {
  readonly lockPath: string;
  readonly snapshotPath: string;
  /** Writes the snapshot back (`python -m tinyg_hil restore`). Rejects on failure. */
  restore(): Promise<void>;
  /** Releases the lock and ends the helper. Never rejects. */
  release(): Promise<void>;
}

export type HilLockOutcome =
  | { readonly ok: true; readonly lock: HilLock }
  | { readonly ok: false; readonly code: 'busy' | 'error'; readonly message: string };

export function acquireHilLock(options: HilLockOptions): Promise<HilLockOutcome> {
  const [command, ...prefix] = options.python;
  if (command === undefined) return Promise.resolve({ ok: false, code: 'error', message: 'no Python command' });
  const child = spawn(command, [...prefix, options.helperPath ?? HELPER_PATH, '--port', options.port, '--out', options.snapshotDir], {
    cwd: options.hilDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.env ?? process.env,
  });
  // The helper may be gone when the runner writes its last command: that is not an error here.
  child.stdin.on('error', () => undefined);
  createInterface({ input: child.stderr }).on('line', (line) => options.log(line));

  type Message = { readonly word: string; readonly rest: string } | { readonly word: 'exit'; readonly rest: string };
  const queue: Message[] = [];
  let waiter: ((m: Message) => void) | null = null;
  const deliver = (m: Message): void => {
    if (waiter !== null) {
      const w = waiter;
      waiter = null;
      w(m);
    } else queue.push(m);
  };
  const next = (): Promise<Message> => {
    const m = queue.shift();
    return m !== undefined ? Promise.resolve(m) : new Promise((resolve) => (waiter = resolve));
  };
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith(PREFIX)) {
      options.log(line);
      return;
    }
    const body = line.slice(PREFIX.length);
    const space = body.indexOf(' ');
    deliver(space < 0 ? { word: body, rest: '' } : { word: body.slice(0, space), rest: body.slice(space + 1) });
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      deliver({ word: 'exit', rest: `the helper did not start: ${error.message}` });
      resolve(null);
    });
    child.on('close', (code) => {
      deliver({ word: 'exit', rest: `the helper exited with code ${code}` });
      resolve(code);
    });
  });

  const fail = async (code: 'busy' | 'error', message: string): Promise<HilLockOutcome> => {
    child.stdin.end();
    await exited;
    return { ok: false, code, message };
  };

  return (async (): Promise<HilLockOutcome> => {
    const first = await next();
    if (first.word === 'busy') return fail('busy', first.rest);
    if (first.word !== 'locked') return fail('error', first.word === 'error' ? first.rest : `${first.word} ${first.rest}`.trim());
    const lockPath = first.rest;
    const snap = await next();
    if (snap.word !== 'snapshot') return fail('error', `snapshot failed: ${snap.rest}`);
    const snapshotPath = snap.rest;
    let released = false;
    const lock: HilLock = {
      lockPath,
      snapshotPath,
      async restore(): Promise<void> {
        if (released) throw new Error('the lock was already released');
        child.stdin.write('restore\n');
        const reply = await next();
        if (reply.word !== 'restored') throw new Error(`restore failed: ${reply.rest}`);
      },
      async release(): Promise<void> {
        if (released) return;
        released = true;
        child.stdin.end('release\n');
        await exited;
      },
    };
    return { ok: true, lock };
  })();
}
