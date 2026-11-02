/**
 * `run-cli bench` (ROADMAP P1-08; RUN_PLAN §8.6; SAFETY §9). In order:
 *   1. refuses to run in CI (HIL never runs in cloud CI);
 *   2. takes the EN-HIL board lock without waiting, and refuses to start if
 *      it is held (nothing has touched the board then);
 *   3. snapshots the board settings with `python -m tinyg_hil snapshot`
 *      inside that lock;
 *   4. launches headed Chrome with a persistent bench profile at the page
 *      under test (staging, or the localhost bench build);
 *   5. steps through the HIL checklist (docs/bench/README.md BENCH rows),
 *      one manual confirmation per item;
 *   6. closes the browser (which lets go of the port), restores the
 *      settings snapshot, and releases the lock, whatever happened in 4-5;
 *   7. writes the run record (`record.json`) next to the snapshot.
 *
 * Everything with side effects is passed in (`BenchDeps`), so the order and
 * the refusals are tested without a board, Python or a browser.
 */
import type { ChecklistItem } from './checklist.ts';
import type { HilLockOptions, HilLockOutcome } from './hilLock.ts';

export const EXIT = Object.freeze({ ok: 0, failed: 1, refused: 2, busy: 3, error: 4 });

/** Pages the runner opens: staging, or the localhost bench build (D41, proposed). */
export function checkTargetUrl(raw: string): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `not a URL: ${raw}` };
  }
  if (url.protocol === 'https:' && url.hostname === 'staging.run.synthetos.com' && url.port === '') return { ok: true, url: url.href };
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return { ok: true, url: url.href };
  return { ok: false, reason: `the bench runs only against https://staging.run.synthetos.com or the localhost bench build, not ${url.origin}` };
}

export interface BenchOptions {
  readonly url: string;
  readonly port: string;
  readonly hilDir: string;
  readonly python: readonly string[];
  /** The Chrome profile kept between runs (the Web Serial grant lives there). */
  readonly profileDir: string;
  /** This run's directory: the snapshot and record.json go here. */
  readonly runDir: string;
  readonly items: readonly ChecklistItem[];
}

export interface BenchBrowser {
  close(): Promise<void>;
}

export interface BenchDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  lock(options: HilLockOptions): Promise<HilLockOutcome>;
  launchBrowser(options: { readonly url: string; readonly profileDir: string }): Promise<BenchBrowser>;
  /** Asks the operator; resolves with the answer line. */
  ask(question: string): Promise<string>;
  log(line: string): void;
  writeFile(path: string, text: string): Promise<void>;
  now(): Date;
}

export type ItemResult = 'pass' | 'fail' | 'skip';

export interface BenchRecord {
  readonly started: string;
  finished: string;
  readonly url: string;
  readonly port: string;
  lockPath: string | null;
  snapshotPath: string | null;
  readonly items: { id: string; covers: string; result: ItemResult; note: string; at: string }[];
  aborted: string | null;
  restore: 'restored' | 'not-run' | { readonly error: string };
}

/** `p`, `f`, `s` or `q` (quit: the remaining items are not run). */
export function parseAnswer(answer: string): ItemResult | 'quit' | null {
  switch (answer.trim().toLowerCase()) {
    case 'p':
    case 'pass':
      return 'pass';
    case 'f':
    case 'fail':
      return 'fail';
    case 's':
    case 'skip':
      return 'skip';
    case 'q':
    case 'quit':
      return 'quit';
    default:
      return null;
  }
}

export async function runBench(options: BenchOptions, deps: BenchDeps): Promise<number> {
  if (deps.env.CI !== undefined && deps.env.CI !== '' && deps.env.CI !== 'false') {
    deps.log('refused: the bench runner drives a real machine and never runs in CI (RUN_PLAN §8.6).');
    return EXIT.refused;
  }
  const target = checkTargetUrl(options.url);
  if (!target.ok) {
    deps.log(`refused: ${target.reason}`);
    return EXIT.refused;
  }
  if (options.items.length === 0) {
    deps.log('refused: no checklist items selected.');
    return EXIT.refused;
  }

  const outcome = await deps.lock({
    python: options.python,
    hilDir: options.hilDir,
    port: options.port,
    snapshotDir: `${options.runDir}/snapshot`,
    log: (line) => deps.log(`  [tinyg_hil] ${line}`),
  });
  if (!outcome.ok) {
    if (outcome.code === 'busy') {
      deps.log(`refused: the board lock for ${options.port} is held (${outcome.message}). Nothing was sent to the board. Wait for the other user, or ask them to stop.`);
      return EXIT.busy;
    }
    deps.log(`refused: could not take the board lock and snapshot the settings: ${outcome.message}`);
    return EXIT.error;
  }
  const lock = outcome.lock;
  const record: BenchRecord = {
    started: deps.now().toISOString(),
    finished: '',
    url: target.url,
    port: options.port,
    lockPath: lock.lockPath,
    snapshotPath: lock.snapshotPath,
    items: [],
    aborted: null,
    restore: 'not-run',
  };
  deps.log(`board lock held (${lock.lockPath}); settings snapshot ${lock.snapshotPath}`);

  let browser: BenchBrowser | null = null;
  try {
    browser = await deps.launchBrowser({ url: target.url, profileDir: options.profileDir });
    deps.log(`Chrome is open at ${target.url}. Connect the board there when an item asks for it.`);
    for (const [index, item] of options.items.entries()) {
      deps.log('');
      deps.log(`[${index + 1}/${options.items.length}] ${item.id}${item.covers === '' ? '' : ` (${item.covers})`}`);
      deps.log(`  ${item.check}`);
      if (item.when !== '') deps.log(`  when: ${item.when}`);
      let answer = parseAnswer(await deps.ask('  result? [p]ass / [f]ail / [s]kip / [q]uit: '));
      while (answer === null) answer = parseAnswer(await deps.ask('  type p, f, s or q: '));
      if (answer === 'quit') {
        record.aborted = `stopped by the operator before ${item.id}`;
        break;
      }
      const note = answer === 'pass' ? '' : (await deps.ask('  note (what you saw): ')).trim();
      record.items.push({ id: item.id, covers: item.covers, result: answer, note, at: deps.now().toISOString() });
    }
  } catch (error) {
    record.aborted = `error: ${error instanceof Error ? error.message : String(error)}`;
    deps.log(record.aborted);
  } finally {
    // The browser goes first: it holds the serial port, and tinyg_hil needs it to restore.
    if (browser !== null) {
      try {
        await browser.close();
      } catch (error) {
        deps.log(`could not close Chrome: ${error instanceof Error ? error.message : String(error)}. Close it before the restore.`);
      }
    }
    deps.log('restoring the settings snapshot…');
    try {
      await lock.restore();
      record.restore = 'restored';
    } catch (error) {
      record.restore = { error: error instanceof Error ? error.message : String(error) };
      deps.log(`RESTORE FAILED: ${record.restore.error}. Restore by hand: python -m tinyg_hil restore --port ${options.port} ${lock.snapshotPath}`);
    }
    await lock.release();
    deps.log('board lock released.');
    record.finished = deps.now().toISOString();
    await deps.writeFile(`${options.runDir}/record.json`, `${JSON.stringify(record, null, 2)}\n`);
    deps.log(`run record: ${options.runDir}/record.json`);
  }
  if (record.restore !== 'restored' || (record.aborted !== null && record.aborted.startsWith('error:'))) return EXIT.error;
  // A run the operator stopped before the end (quit, Ctrl-C) did not check every item: never exit 0 for it.
  return record.items.some((i) => i.result === 'fail') || record.aborted !== null ? EXIT.failed : EXIT.ok;
}
