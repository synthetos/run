import { copyPage } from './files-copy.ts';
import { checkpoints } from './files-checkpoint.ts';
import { freshScan, loadState, nextScan } from './files-state.ts';
import { samplePage, verifyFile } from './files-verify.ts';
import { DEFAULT_OPTIONS, filesPrefix, MAX_FILE_BYTES, type FileBackup, type FileOptions, type FileSource, type FileState, type FileStats } from './files-types.ts';
interface Job { source?: FileSource | undefined; backup: FileBackup; environment: string; date: Date; log: (record: Record<string, unknown>) => void }
interface Run { job: Job; options: FileOptions; state: FileState; stats: FileStats; prefix: string; save: () => Promise<boolean>; available: () => boolean }
async function copyFiles(run: Run): Promise<void> {
  const { job, state, stats, options } = run;
  if (state.copy.complete) state.copy = freshScan();
  for (let page = 0; page < options.maxPages && run.available(); page++) {
    const listed = await job.source!.list({ ...(state.copy.cursor === undefined ? {} : { cursor: state.copy.cursor }), limit: Math.min(10, options.maxObjects - stats.examined) });
    if (!await copyPage({ source: job.source!, backup: job.backup, prefix: run.prefix }, listed.objects, stats, run.available)) return;
    state.copy = nextScan(state.copy, listed);
    if (!await run.save()) return;
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
    if (!await run.save()) return;
    if (state.inventory.complete) return;
  }
}
export async function filesScheduled(job: Job, overrides: Partial<FileOptions> = {}): Promise<void> {
  if (!job.source) { job.log({ component: 'files', status: 'skipped', reason: 'source-bucket-absent' }); return; }
  const options = { ...DEFAULT_OPTIONS, ...overrides }, started = options.now();
  const prefix = filesPrefix(job.environment), key = `${job.environment === 'staging' ? 'staging/' : ''}backup-state/run-files.json`;
  const stats: FileStats = { copied: 0, skipped: 0, failed: 0, bytes: 0, examined: 0 };
  let state: FileState | undefined, restore = 'not-due', checkpointDeferred = false;
  try {
    state = await loadState(job.backup, key);
    const writer = checkpoints(job.backup, key, { now: options.now, sleep: options.sleep, deadline: started + options.maxMs }, state);
    const phase = state.nextPhase ?? 'copy';
    // Commit the next first turn BEFORE expensive work, even if that work uses the whole deadline.
    state.nextPhase = phase === 'copy' ? 'maintenance' : 'copy';
    if (job.date.getUTCDate() === 1) state.restoreDue = true;
    const run: Run = { job, options, state, stats, prefix, save: () => writer.save(run.state), available: writer.available };
    restore = await runPhases(run, phase);
    checkpointDeferred = writer.deferred();
  } catch {
    stats.failed++; job.log({ component: 'files', status: 'failed', ...stats, sourceObjects: state?.copy.count ?? null, backupObjects: state?.inventory.count ?? null, countsComplete: false, restore, elapsedMs: options.now() - started });
    throw new Error('File backup failed; see structured summary');
  }
  job.log({ component: 'files', status: !checkpointDeferred && state.copy.complete && state.inventory.complete ? 'ok' : 'partial', ...stats, checkpointDeferred, sourceObjects: state.copy.count, backupObjects: state.inventory.count, sourceComplete: state.copy.complete, backupComplete: state.inventory.complete, restore, elapsedMs: options.now() - started });
}

async function runPhases(run: Run, first: 'copy' | 'maintenance'): Promise<string> {
  const { stats, options } = run;
  // Keep a whole maximum-sized object inside the byte budget; check at object boundaries.
  const copyRun = { ...run, available: () => run.available() && stats.examined < options.maxObjects && stats.bytes + MAX_FILE_BYTES <= options.maxBytes };
  let restore = run.state.restoreDue ? 'pending' : 'not-due';
  if (!await run.save()) return restore;
  if (first === 'copy') await copyFiles(copyRun);
  if (run.available()) { await inventory(run); restore = await restoreFiles(run); }
  if (first === 'maintenance' && run.available()) await copyFiles(copyRun);
  return restore;
}

async function restoreFiles(run: Run): Promise<string> {
  if (!run.state.restoreDue) return 'not-due';
  if (!run.state.inventory.complete || !run.available()) return 'pending';
  while (run.state.samples.length > 0) {
    if (!run.available()) return 'pending';
    await verifyFile(run.job.backup, run.state.samples[0]!, run.prefix);
    run.state.samples.shift();
    if (!await run.save()) return 'pending';
  }
  run.state.restoreDue = false;
  return await run.save() ? 'passed' : 'pending';
}
