/**
 * The Console command line's reads (WORKSPACE_FEATURES "Console command
 * line", Phase 1: reads only). One allowlisted GET through the machine
 * worker's `read` request, the same path as the settings backup: the session
 * checks the token against the dialect's read allowlist again (SAFETY H37)
 * and sends `{"<token>":null}`. Nothing here can write to the board.
 *
 * The answer arrives in a later snapshot (`values[token]`), so the read waits
 * for a value newer than the one before, the link to change, or a timeout.
 */
import type { MachineReply, WorkerStatus } from '../machine-worker/rpc.ts';

type SessionSnapshot = WorkerStatus['session'];
type ReadValue = SessionSnapshot['values'][string];

/** How long a console read waits for its answer. */
export const CONSOLE_READ_TIMEOUT_MS = 5000;

/** Base states in which a job is streaming (SAFETY §4.1): the command line sends nothing then. */
export const JOB_STREAMING_STATES: ReadonlySet<string> = new Set(['PREAMBLE', 'RUNNING', 'HOLD_REQUESTED', 'HELD', 'BARRIER_DRAINING', 'PROGRAM_PAUSED', 'END_HOLDBACK', 'STOPPING_JOB']);

export function jobStreaming(s: Pick<SessionSnapshot, 'base'> | null): boolean {
  return s !== null && JOB_STREAMING_STATES.has(s.base);
}

export type ConsoleAnswer =
  | { readonly ok: true; readonly value: unknown; readonly status: number; readonly raw: string | null }
  | { readonly ok: false; readonly message: string };

export interface ConsoleReadDeps {
  readonly snapshot: () => SessionSnapshot | null;
  readonly read: (tokens: readonly string[]) => Promise<MachineReply | { readonly ok: false; readonly message: string }>;
  readonly transcript: () => Promise<string | null>;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

function hexText(hex: string): string {
  let s = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = Number.parseInt(hex.slice(i, i + 2), 16);
    if (c >= 32 && c !== 127) s += String.fromCharCode(c);
  }
  return s;
}

/** The last line the board sent that answers `token` (`{"r":{"xvm":…}…}`), from the transcript, or null. */
export function rawAnswer(jsonl: string | null, token: string): string | null {
  if (jsonl === null) return null;
  const rows = jsonl.trim().split('\n');
  const needle = `"${token}"`;
  for (let i = rows.length - 1; i >= 0 && i >= rows.length - 400; i--) {
    try {
      const e = JSON.parse(rows[i] as string) as { dir?: unknown; hex?: unknown };
      if (e.dir !== 'rx' || typeof e.hex !== 'string') continue;
      const text = hexText(e.hex).trim();
      if (text.includes(needle)) return text;
    } catch {
      // A damaged row is skipped.
    }
  }
  return null;
}

export class ConsoleReader {
  #snapshot: SessionSnapshot | null = null;
  readonly #waiters = new Set<() => void>();
  #busy = false;

  get busy(): boolean {
    return this.#busy;
  }

  /** Feed every snapshot from the worker. */
  onSnapshot(s: SessionSnapshot): void {
    this.#snapshot = s;
    for (const w of [...this.#waiters]) w();
  }

  #answer(token: string, before: ReadValue | undefined, epoch: number, deps: ConsoleReadDeps): Promise<ReadValue | 'timeout' | 'link'> {
    return new Promise((resolve) => {
      let timer: unknown = null;
      const check = (): void => {
        const s = this.#snapshot;
        let result: ReadValue | 'link' | null = null;
        if (s === null || s.epoch !== epoch || s.base === 'NOT_CONNECTED' || s.overlays.includes('LOST')) result = 'link';
        else {
          const v = s.values[token];
          if (v !== undefined && (before === undefined || v.at !== before.at)) result = v;
        }
        if (result === null) return;
        this.#waiters.delete(check);
        deps.clearTimeout(timer);
        resolve(result);
      };
      timer = deps.setTimeout(() => {
        this.#waiters.delete(check);
        resolve('timeout');
      }, CONSOLE_READ_TIMEOUT_MS);
      this.#waiters.add(check);
      check();
    });
  }

  /** One read of `token`. Refused while a job streams, while another console read waits, or with no board. */
  async read(token: string, deps: ConsoleReadDeps): Promise<ConsoleAnswer> {
    const s = deps.snapshot() ?? this.#snapshot;
    if (s === null || s.base === 'NOT_CONNECTED') return { ok: false, message: 'No board is connected.' };
    if (jobStreaming(s)) return { ok: false, message: 'A job is streaming, so the command line sends nothing until it ends.' };
    if (this.#busy) return { ok: false, message: 'Wait for the answer to the last read.' };
    this.#busy = true;
    try {
      const before = s.values[token];
      const reply = await deps.read([token]).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
      if (!reply.ok) {
        const d = 'decision' in reply ? reply.decision : undefined;
        return { ok: false, message: d === undefined ? reply.message : `${d.reason} ${d.remedy}`.trim() };
      }
      const answer = await this.#answer(token, before, s.epoch, deps);
      if (answer === 'link') return { ok: false, message: 'The connection changed before the board answered.' };
      if (answer === 'timeout') return { ok: false, message: `No answer within ${CONSOLE_READ_TIMEOUT_MS / 1000} s.` };
      const raw = rawAnswer(await deps.transcript().catch(() => null), token);
      return { ok: true, value: answer.value, status: answer.status, raw };
    } finally {
      this.#busy = false;
    }
  }
}
