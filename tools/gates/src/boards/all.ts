/**
 * Repository paths and the full render of the board definition generator
 * (ROADMAP TB-05a). Used by `pnpm gen:boards` (gen.ts) and by the drift test.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseOverlay, renderTinyGBoards } from './render.ts';
import type { BoardOverlay } from './render.ts';
import { TINYG_FACTS_FORMAT, extractTinyG } from './tinyg.ts';
import type { TinyGFacts } from './tinyg.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const FACTS_DIR = join(REPO_ROOT, 'vendor/tinyg-board-facts');
export const SCHEMA_DIR = join(REPO_ROOT, 'packages/schema');
export const OVERLAY_DIR = join(SCHEMA_DIR, 'boards/overlays');
/** The firmware pin whose sources the TinyG boards are generated from. */
export const TINYG_TAG = 'EN';

export function pinnedCommit(tag: string, root: string = REPO_ROOT): string {
  const pins = JSON.parse(readFileSync(join(root, 'vendor/firmware-pins.json'), 'utf8')) as { pins: Record<string, { commit: string }> };
  const pin = pins.pins[tag];
  if (pin === undefined) throw new Error(`gen-boards: vendor/firmware-pins.json has no ${tag} pin`);
  return pin.commit;
}

export function readFacts(root: string = REPO_ROOT): TinyGFacts {
  const facts = JSON.parse(readFileSync(join(root, 'vendor/tinyg-board-facts', `${TINYG_TAG}.json`), 'utf8')) as TinyGFacts;
  if (facts.format !== TINYG_FACTS_FORMAT) throw new Error(`gen-boards: ${TINYG_TAG}.json format must be ${TINYG_FACTS_FORMAT}`);
  return facts;
}

export function readOverlays(root: string = REPO_ROOT): BoardOverlay[] {
  const dir = join(root, 'packages/schema/boards/overlays');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseOverlay(JSON.parse(readFileSync(join(dir, f), 'utf8')), `boards/overlays/${f}`));
}

/** Every generated file (path under packages/schema/ to text) from the committed facts and overlays. */
export function renderAllBoards(root: string = REPO_ROOT): Map<string, string> {
  return renderTinyGBoards(readFacts(root), readOverlays(root));
}

/**
 * Extract the TinyG facts from a local TinyG clone with `git show` only: the
 * firmware working tree is never checked out, stashed or written.
 */
export function extractFromRepo(tinygRepo: string, root: string = REPO_ROOT): TinyGFacts {
  const commit = pinnedCommit(TINYG_TAG, root);
  return extractTinyG((path) => execFileSync('git', ['-C', tinygRepo, 'show', `${commit}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 24 }), TINYG_TAG, commit);
}
