/**
 * LOCAL ONLY. Derive connector facts for one board from the owner's private
 * KiCad sources and print an overlay fragment on stdout (ROADMAP TB-05a).
 *
 *   pnpm gen:boards-hw <hardware-repo> <board-folder> <board-id>
 *
 * It writes nothing. The owner reviews the printed connectors, adds `signal`
 * to the pins that carry firmware signals, and pastes the result into
 * packages/schema/boards/overlays/<board-id>.json; `pnpm gen:boards` then
 * checks every signal against the generated pin map. Sources are read with
 * `git ls-files` and `git show HEAD:<path>` so only committed files are used.
 */
import { execFileSync } from 'node:child_process';
import { deriveConnectors } from './hw.ts';

const [repo, folder, board] = process.argv.slice(2);
if (repo === undefined || folder === undefined || board === undefined) {
  process.stderr.write('usage: pnpm gen:boards-hw <hardware-repo> <board-folder> <board-id>\n');
  process.exit(2);
}
const git = (...args: string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const commit = git('rev-parse', 'HEAD').trim();
const files = git('ls-files', '--', folder)
  .split('\n')
  .filter((p) => p.endsWith('.kicad_sch'))
  .map((relPath) => ({ relPath, text: git('show', `HEAD:${relPath}`) }));
if (files.length === 0) {
  process.stderr.write(`gen-boards-hw: no KiCad 6+ schematics for ${board}; nothing derived\n`);
  process.exit(1);
}
const connectors = deriveConnectors(files, commit);
process.stdout.write(`${JSON.stringify({ board, connectors }, null, 2)}\n`);
