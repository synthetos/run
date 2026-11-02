/** Command-line options of `run-cli bench`. Pure, so it is tested without a process. */

export interface BenchArgs {
  readonly port: string;
  readonly hilDir: string;
  readonly url: string;
  readonly python: readonly string[];
  readonly profileDir: string | null;
  readonly outDir: string | null;
  readonly checklist: string | null;
  readonly only: readonly string[];
  readonly noRestore: boolean;
}

export const DEFAULT_URL = 'https://staging.run.synthetos.com/';
export const DEFAULT_PYTHON: readonly string[] = Object.freeze(['uv', 'run', 'python']);

export const BENCH_USAGE = `run-cli bench --port <serial port> --hil-dir <edge-next tests/hil> [options]

  Takes the EN-HIL board lock (refuses if it is held), snapshots the board
  settings with python -m tinyg_hil, opens headed Chrome at the page under
  test, steps through the bench checklist (docs/bench/README.md) with a
  manual confirmation per item, then restores the settings and releases
  the lock. Never in CI. See docs/bench/policy.md first.

  --url <url>         staging (default ${DEFAULT_URL}) or http://localhost:<port>/ (bench build)
  --python "<cmd>"    Python command run in --hil-dir (default "${DEFAULT_PYTHON.join(' ')}")
  --profile <dir>     Chrome profile kept between runs (default ~/.run-bench/chrome-profile)
  --out <dir>         this run's directory (default ~/.run-bench/runs/<time>)
  --checklist <file>  checklist markdown (default docs/bench/README.md)
  --only <prefix>     only items whose id starts with it, e.g. BENCH-P102 (repeatable)
  --no-restore        do not write the settings snapshot back at the end

  The snapshot and the restore send G21 and (restore) settings writes to the
  board: expect them in a capture of the run. Both are refused unless the
  board is idle with an empty planner; the restore also needs the same board
  (id, fb) and asks first.
`;

export function parseBenchArgs(argv: readonly string[]): { readonly ok: true; readonly args: BenchArgs } | { readonly ok: false; readonly message: string } {
  const values: Record<string, string> = {};
  const only: string[] = [];
  const flags = new Set(['--port', '--hil-dir', '--url', '--python', '--profile', '--out', '--checklist', '--only']);
  let noRestore = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    if (flag === '--no-restore') {
      noRestore = true;
      continue;
    }
    if (!flags.has(flag)) return { ok: false, message: `unknown option: ${flag}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { ok: false, message: `${flag} needs a value` };
    i++;
    if (flag === '--only') only.push(value);
    else if (flag in values) return { ok: false, message: `${flag} given twice` };
    else values[flag] = value;
  }
  const port = values['--port'];
  const hilDir = values['--hil-dir'];
  if (port === undefined) return { ok: false, message: '--port is required' };
  if (hilDir === undefined) return { ok: false, message: '--hil-dir is required' };
  const python = values['--python'] === undefined ? DEFAULT_PYTHON : values['--python'].split(/\s+/).filter((w) => w !== '');
  if (python.length === 0) return { ok: false, message: '--python is empty' };
  return {
    ok: true,
    args: Object.freeze({
      port,
      hilDir,
      url: values['--url'] ?? DEFAULT_URL,
      python: Object.freeze([...python]),
      profileDir: values['--profile'] ?? null,
      outDir: values['--out'] ?? null,
      checklist: values['--checklist'] ?? null,
      only: Object.freeze(only),
      noRestore,
    }),
  };
}
