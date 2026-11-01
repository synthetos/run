/**
 * Builds the run Worker for the artifact (ROADMAP P0-04; see worker.ts):
 *
 *   node tools/gates/src/build/worker-cli.ts <workers/run/src> <out-dir>
 *
 * Writes `<out-dir>/<name>.mjs` for every source file. The output directory
 * must not exist yet. Exit status: 0 built, 1 the source was refused, 2 the
 * command could not run.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorker, WorkerBuildError } from './worker.ts';

function main(argv: readonly string[]): number {
  const [srcDir, outDir] = argv;
  if (srcDir === undefined || outDir === undefined || argv.length !== 2) {
    process.stderr.write('usage: build/worker-cli.ts <workers/run/src> <out-dir>\n');
    return 2;
  }
  try {
    if (existsSync(outDir)) throw new Error(`${outDir} already exists; the Worker is built into a fresh directory`);
    const files = readdirSync(srcDir)
      .sort()
      .map((name) => {
        if (!lstatSync(join(srcDir, name)).isFile()) throw new WorkerBuildError(`${name}: only flat .ts files are allowed in ${srcDir}`);
        return { name, source: readFileSync(join(srcDir, name), 'utf8') };
      });
    const built = buildWorker(files);
    mkdirSync(outDir, { recursive: true });
    for (const m of built) writeFileSync(join(outDir, m.name), m.code);
    process.stdout.write(`worker build: ${built.length} modules written to ${outDir}\n`);
    return 0;
  } catch (error) {
    const refused = error instanceof WorkerBuildError;
    process.stderr.write(`worker build: ${refused ? 'refused' : 'could not run'}: ${error instanceof Error ? error.message : String(error)}\n`);
    return refused ? 1 : 2;
  }
}

process.exitCode = main(process.argv.slice(2));
