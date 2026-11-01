/**
 * The localhost bench server CLI (P1-00). From the repository root:
 *
 *   pnpm build:bench && pnpm bench:check && pnpm bench:serve
 *
 * or `node tools/gates/src/bench/cli.ts [--port <n>] [bench site directory]`
 * (default apps/web/dist-bench, port 8793). Open http://localhost:8793/ in
 * Chrome or Edge. It listens on 127.0.0.1 only and refuses to start on a
 * tree that is not a clean bench build (server.ts).
 *
 * Exit status: 2 could not start (bad usage, missing or refused tree).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readTree } from '../shared/files.ts';
import { BENCH_DEFAULT_PORT, BenchSiteRefused, benchSite, listen } from './server.ts';

const USAGE = 'usage: bench/cli.ts [--port <1024-65535>] [bench site directory]\n';

async function main(argv: readonly string[]): Promise<number> {
  let port = BENCH_DEFAULT_PORT;
  let dir = 'apps/web/dist-bench';
  try {
    const { values, positionals } = parseArgs({ args: [...argv], options: { port: { type: 'string' } }, allowPositionals: true });
    if (positionals.length > 1) throw new Error('one directory at most');
    if (values.port !== undefined) {
      port = Number(values.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`--port must be an integer from 1024 to 65535, got ${values.port}`);
    }
    if (positionals[0] !== undefined) dir = positionals[0];
  } catch (error) {
    process.stderr.write(`bench: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const root = resolve(dir);
  try {
    if (!existsSync(root)) throw new Error(`${root} does not exist: run pnpm build:bench first`);
    const site = benchSite(readTree(root));
    const { port: bound } = await listen(site, port);
    process.stdout.write(
      [
        `bench: serving the BENCH build from ${root}`,
        `bench: open http://localhost:${bound}/ (listening on 127.0.0.1 only; Web Serial granted to this origin)`,
        'bench: this build is for this computer only. It is never deployed. Stop with Ctrl-C.',
        '',
      ].join('\n'),
    );
    return 0;
  } catch (error) {
    const detail = error instanceof BenchSiteRefused ? `${error.message}\n` : `${error instanceof Error ? error.message : String(error)}\n`;
    process.stderr.write(`bench: refused to start: ${detail}`);
    return 2;
  }
}

const status = await main(process.argv.slice(2));
if (status !== 0) process.exitCode = status;
