// Node entry point (Node >= 22.12 runs .ts via type stripping): `node src/main.ts bench …`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './bench/browser.ts';
import { acquireHilLock } from './bench/hilLock.ts';
import { BENCH_USAGE, EXIT, parseBenchArgs, parseChecklist, runBench, selectItems, usage } from './index.ts';

const DEFAULT_CHECKLIST = fileURLToPath(new URL('../../../docs/bench/README.md', import.meta.url));

async function bench(argv: readonly string[]): Promise<number> {
  const parsed = parseBenchArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${BENCH_USAGE}`);
    return EXIT.refused;
  }
  const { args } = parsed;
  const items = selectItems(parseChecklist(await readFile(args.checklist ?? DEFAULT_CHECKLIST, 'utf8')), args.only);
  const home = join(homedir(), '.run-bench');
  const runDir = args.outDir ?? join(home, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
  const profileDir = args.profileDir ?? join(home, 'chrome-profile');
  await mkdir(runDir, { recursive: true });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl-C ends the questions; runBench's finally still closes Chrome and unlocks (an interrupted run never restores: the restore needs a yes).
  let interrupted = false;
  rl.on('SIGINT', () => {
    interrupted = true;
    rl.close();
  });
  try {
    return await runBench(
      { url: args.url, port: args.port, hilDir: args.hilDir, python: args.python, profileDir, runDir, items, noRestore: args.noRestore },
      {
        env: process.env,
        lock: acquireHilLock,
        launchBrowser: launchChrome,
        ask: async (question) => {
          if (interrupted) return 'q';
          try {
            return await rl.question(question);
          } catch {
            return 'q';
          }
        },
        log: (line) => process.stdout.write(`${line}\n`),
        writeFile: (path, text) => writeFile(path, text, 'utf8'),
        now: () => new Date(),
      },
    );
  } finally {
    rl.close();
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'bench') process.exitCode = await bench(rest);
else {
  process.stdout.write(usage());
  process.exitCode = command === undefined ? 0 : EXIT.refused;
}
