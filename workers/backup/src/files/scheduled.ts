import { copyPage } from './copy.ts';
import { freshScan, loadState, nextScan, saveState } from './state.ts';
import { samplePage, verifyFile } from './verify.ts';
import { DEFAULT_OPTIONS, filesPrefix, MAX_FILE_BYTES, type FileBackup, type FileOptions, type FileSource, type FileState, type FileStats } from './types.ts';
interface Job { source?: FileSource | undefined; backup: FileBackup; environment: string; date: Date; log: (record: Record<string, unknown>) => void }
interface Run { job: Job; options: FileOptions; state: FileState; stats: FileStats; prefix: string; key: string; available: () => boolean }
async function copyFiles(run: Run): Promise<void> {
  const { job, state, stats, options } = run;
  if (state.copy.complete) state.copy = freshScan();
  for (let page = 0; page < options.maxPages && run.available(); page++) {
    const listed = await job.source!.list({ ...(state.copy.cursor === undefined ? {} : { cursor: state.copy.cursor }), limit: Math.min(10, options.maxObjects - stats.examined) });
    if (!await copyPage({ source: job.source!, backup: job.backup, prefix: run.prefix }, listed.objects, stats, run.available)) return;
    state.copy = nextScan(state.copy, listed);
    await saveState(job.backup, run.key, state);
    if (state.copy.complete) return;
  }
}
async function inventory(run: Run): Promise<void> {
  const { job, state, options } = run;
  if (state.inventory.complete && state.restoreDue) return;
  if (state.inventory.complete) { state.inventory = freshScan(); state.samples = []; }
  for (let page = 0; page < options.maxPages && run.available(); page++) {
    const listed = await job.backup.list({ prefix: run.prefix, ...(state.inventory.cursor === undefined ? {} : { cursor: state.inventory.cursor }), limit: 500 });
    samplePage(state, listed.objects, options.random);
    state.inventory = nextScan(state.inventory, listed);
    await saveState(job.backup, run.key, state);
    if (state.inventory.complete) return;
  }
}
export async function filesScheduled(job: Job, overrides: Partial<FileOptions> = {}): Promise<void> {
  if (!job.source) { job.log({ component: 'files', status: 'skipped', reason: 'source-bucket-absent' }); return; }
  const options = { ...DEFAULT_OPTIONS, ...overrides }, started = options.now();
  const prefix = filesPrefix(job.environment), key = `${job.environment === 'staging' ? 'staging/' : ''}backup-state/run-files.json`;
  const stats: FileStats = { copied: 0, skipped: 0, failed: 0, bytes: 0, examined: 0 };
  let state: FileState | undefined, restore = 'not-due';
  try {
    state = await loadState(job.backup, key);
    await markRestoreDue(job, state, key);
    const run: Run = { job, options, state, stats, prefix, key, available: () => options.now() - started < options.maxMs };
    // Keep a whole maximum-sized object inside the byte budget; check at object boundaries.
    const copyRun = { ...run, available: () => run.available() && stats.examined < options.maxObjects && stats.bytes + MAX_FILE_BYTES <= options.maxBytes };
    restore = await restoreFiles(run);
    await copyFiles(copyRun);
    await inventory(run);
    const checked = await restoreFiles(run);
    if (checked !== 'not-due') restore = checked;
    await saveState(job.backup, key, state);
  } catch {
    stats.failed++; job.log({ component: 'files', status: 'failed', ...stats, sourceObjects: state?.copy.count ?? null, backupObjects: state?.inventory.count ?? null, countsComplete: false, restore, elapsedMs: options.now() - started });
    throw new Error('File backup failed; see structured summary');
  }
  job.log({ component: 'files', status: state.copy.complete && state.inventory.complete ? 'ok' : 'partial', ...stats, sourceObjects: state.copy.count, backupObjects: state.inventory.count, sourceComplete: state.copy.complete, backupComplete: state.inventory.complete, restore, elapsedMs: options.now() - started });
}

async function restoreFiles(run: Run): Promise<string> {
  if (!run.state.restoreDue) return 'not-due';
  if (!run.state.inventory.complete || !run.available()) return 'pending';
  while (run.state.samples.length > 0) {
    if (!run.available()) return 'pending';
    await verifyFile(run.job.backup, run.state.samples[0]!, run.prefix);
    run.state.samples.shift();
    await saveState(run.job.backup, run.key, run.state);
  }
  run.state.restoreDue = false;
  return 'passed';
}

async function markRestoreDue(job: Job, state: FileState, key: string): Promise<void> {
  if (job.date.getUTCDate() !== 1 || state.restoreDue) return;
  state.restoreDue = true;
  await saveState(job.backup, key, state);
}
