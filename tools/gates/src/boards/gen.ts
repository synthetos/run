/**
 * Board definition generator (ROADMAP TB-05a).
 *
 *   pnpm gen:boards              render from the committed facts and overlays
 *   pnpm gen:boards --extract    first re-extract vendor/tinyg-board-facts/EN.json
 *                                from a local TinyG clone at the pinned commit
 *                                (TINYG_REPO, default ../TinyG beside this repo)
 *
 * Writes packages/schema/boards/tinyg/*.json and
 * packages/schema/src/generated/boards.ts. tools/gates/test/boards-gen.test.ts
 * fails whenever a committed file differs from a fresh render.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FACTS_DIR, REPO_ROOT, TINYG_TAG, SCHEMA_DIR, extractFromRepo, renderAllBoards } from './all.ts';
import { renderFacts } from './tinyg.ts';

if (process.argv.includes('--extract')) {
  const repo = process.env['TINYG_REPO'] ?? resolve(REPO_ROOT, '../TinyG');
  const target = join(FACTS_DIR, `${TINYG_TAG}.json`);
  writeFileSync(target, renderFacts(extractFromRepo(repo)));
  process.stdout.write(`gen-boards: wrote ${target}\n`);
}
for (const [path, text] of renderAllBoards()) {
  const target = join(SCHEMA_DIR, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  process.stdout.write(`gen-boards: wrote ${target}\n`);
}
