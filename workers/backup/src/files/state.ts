import type { FileBackup, FileState, Scan } from './types.ts';
export function freshScan(): Scan { return { count: 0, complete: false }; }
function validScan(value: Scan): boolean {
  return value != null && Number.isSafeInteger(value.count) && value.count >= 0 && typeof value.complete === 'boolean' && (value.cursor === undefined || typeof value.cursor === 'string');
}
export async function loadState(bucket: FileBackup, key: string): Promise<FileState> {
  const object = await bucket.get(key);
  if (!object) return { version: 1, copy: freshScan(), inventory: freshScan(), samples: [], restoreDue: false };
  if (object.size > 32_768) throw new Error('Invalid file backup cursor');
  const state = JSON.parse(await object.text()) as FileState;
  if (state.version !== 1 || !validScan(state.copy) || !validScan(state.inventory) || typeof state.restoreDue !== 'boolean' || !Array.isArray(state.samples) || state.samples.length > 5 || state.samples.some(s => typeof s.key !== 'string' || !Number.isSafeInteger(s.size) || s.size < 0)) throw new Error('Invalid file backup cursor');
  return state;
}
export async function saveState(bucket: FileBackup, key: string, state: FileState): Promise<void> {
  if (await bucket.put(key, JSON.stringify(state)) === null) throw new Error('File backup cursor not saved');
}
export function nextScan(scan: Scan, page: { objects: unknown[]; truncated: boolean; cursor?: string }): Scan {
  if (page.truncated && (!page.cursor || page.cursor === scan.cursor)) throw new Error('Invalid file listing cursor');
  return { count: scan.count + page.objects.length, complete: !page.truncated, ...(page.truncated ? { cursor: page.cursor! } : {}) };
}
