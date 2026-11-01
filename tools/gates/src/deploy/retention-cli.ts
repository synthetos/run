/**
 * Asset retention for the deploy jobs (ROADMAP P0-04; see retention.ts).
 *
 *   node tools/gates/src/deploy/retention-cli.ts merge \
 *     --env <production|staging> --commit <sha> --now <iso-time> \
 *     --site <verified site dir> (--previous <state dir> | --no-previous) \
 *     --out <new dir to deploy> --state-out <new dir to upload>
 *
 * `--out` receives a copy of the site plus the retained assets; it is what
 * wrangler deploys. `--state-out` receives `retention.json` and every asset
 * it lists; the deploy job uploads it as `run-deployed-<env>` for the next
 * deploy. Both output directories must not exist. `--no-previous` is the
 * explicit choice for the first deploy (or when no trusted previous state
 * exists); it is never implied by a missing directory.
 *
 * Exit status: 0 merged, 1 refused, 2 could not run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { readTree } from '../shared/files.ts';
import { formatState, mergeRetained, parseState, RetentionError, STATE_FILE } from './retention.ts';
import { isDeployEnvironment } from './wranglerConfig.ts';

function writeTree(root: string, files: readonly { path: string; bytes: Uint8Array }[]): void {
  for (const f of files) {
    const target = join(root, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.bytes);
  }
}

function main(argv: readonly string[]): number {
  try {
    const { positionals, values } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        env: { type: 'string' },
        commit: { type: 'string' },
        now: { type: 'string' },
        site: { type: 'string' },
        previous: { type: 'string' },
        'no-previous': { type: 'boolean' },
        out: { type: 'string' },
        'state-out': { type: 'string' },
      },
    });
    const { env, commit, now, site, previous, out } = values;
    const stateOut = values['state-out'];
    const noPrevious = values['no-previous'] === true;
    if (positionals.join(' ') !== 'merge' || env === undefined || commit === undefined || now === undefined || site === undefined || out === undefined || stateOut === undefined) {
      throw new Error('usage: retention-cli.ts merge --env --commit --now --site (--previous <dir> | --no-previous) --out --state-out');
    }
    if (!isDeployEnvironment(env)) throw new Error(`unknown environment '${env}'`);
    if ((previous === undefined) === !noPrevious) throw new Error('give exactly one of --previous <dir> and --no-previous');
    const nowDate = new Date(now);
    if (Number.isNaN(nowDate.getTime())) throw new Error(`--now '${now}' is not a time`);
    for (const dir of [out, stateOut]) if (existsSync(dir)) throw new Error(`${dir} already exists`);

    const siteFiles = readTree(site);
    let prev = null;
    if (previous !== undefined) {
      const files = readTree(previous).filter((f) => f.path !== STATE_FILE);
      prev = { state: parseState(readFileSync(join(previous, STATE_FILE), 'utf8')), files };
    }
    const result = mergeRetained({ env, commit, now: nowDate, site: siteFiles, previous: prev });

    writeTree(out, [...siteFiles, ...result.retained]);
    const listed = new Set(Object.keys(result.state.assets));
    writeTree(stateOut, [...siteFiles, ...result.retained].filter((f) => listed.has(f.path)));
    writeFileSync(join(stateOut, STATE_FILE), formatState(result.state));

    process.stdout.write(
      `retention (${env}): ${listed.size - result.retained.length} current, ${result.retained.length} retained, ${result.expired.length} expired\n`,
    );
    for (const p of result.retained) process.stdout.write(`  retained ${p.path} (current until ${result.state.assets[p.path]?.lastCurrent ?? '?'})\n`);
    for (const p of result.expired) process.stdout.write(`  expired  ${p}\n`);
    return 0;
  } catch (error) {
    const refused = error instanceof RetentionError;
    process.stderr.write(`retention: ${refused ? 'refused' : 'could not run'}: ${error instanceof Error ? error.message : String(error)}\n`);
    return refused ? 1 : 2;
  }
}

process.exitCode = main(process.argv.slice(2));
