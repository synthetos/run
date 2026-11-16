import type { FileBackup, FileState } from './files-types.ts';

interface Clock { now: () => number; sleep: (ms: number) => Promise<void>; deadline: number }
const WRITE_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 3;

function throttled(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('status' in error && error.status === 429) return true;
  return error instanceof Error && /\b429\b|too many requests|rate.?limit/i.test(error.message);
}

/** Serial use only. Failed/deferred writes never replace the last durable snapshot. */
export function checkpoints(bucket: FileBackup, key: string, clock: Clock, initial: FileState) {
  let durable = JSON.stringify(initial), nextWrite = 0, stopped = false;
  const available = () => !stopped && clock.now() < clock.deadline;
  async function waitUntilReady(): Promise<boolean> {
    const delay = Math.max(0, nextWrite - clock.now());
    if (!available() || clock.now() + delay >= clock.deadline) return false;
    if (delay > 0) await clock.sleep(delay);
    return available();
  }
  async function save(state: FileState): Promise<boolean> {
    const body = JSON.stringify(state);
    if (body === durable) return true;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (!await waitUntilReady()) break;
      try {
        if (await bucket.put(key, body) === null) throw new Error('File backup cursor not saved');
        durable = body;
        nextWrite = clock.now() + WRITE_INTERVAL_MS;
        return true;
      } catch (error) {
        if (!throttled(error)) throw error;
        nextWrite = clock.now() + WRITE_INTERVAL_MS * 2 ** attempt;
      }
    }
    stopped = true;
    return false;
  }
  return { save, available, deferred: () => stopped };
}
