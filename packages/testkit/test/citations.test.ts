/**
 * Every behaviour citation is checked against the pinned firmware source.
 *
 * The TinyG repository is not available in CI, so this check runs locally:
 * set RUN_FIRMWARE_REPO to a TinyG clone that has the pinned commits
 * (vendor/firmware-pins.json) and run the test kit. It only reads with
 * `git show <commit>:<path>`; it never checks out or changes anything.
 * Without the variable the check is skipped, visibly.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEHAVIOURS } from '../src/honesty/behaviours.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const FIRMWARE = process.env['RUN_FIRMWARE_REPO'];
const pins = (JSON.parse(readFileSync(join(REPO_ROOT, 'vendor/firmware-pins.json'), 'utf8')) as { pins: Record<string, { commit: string }> }).pins;

describe('citations', () => {
  it('cite the pinned commits only (EN and EN-HIL at the EN pin, TG at the TG pin)', () => {
    expect(pins['EN']?.commit).toMatch(/^ead63997/);
    expect(pins['TG']?.commit).toMatch(/^d0418390/);
    const sources = new Set(BEHAVIOURS.flatMap((b) => b.cites.map((c) => c.src)));
    expect([...sources].sort()).toEqual(['EN', 'EN-HIL', 'TG']);
  });

  it.skipIf(FIRMWARE === undefined)('every cited line range contains its quote at the pinned commit (RUN_FIRMWARE_REPO)', () => {
    const cache = new Map<string, string[]>();
    const problems: string[] = [];
    for (const b of BEHAVIOURS) {
      for (const c of b.cites) {
        const commit = (c.src === 'TG' ? pins['TG'] : pins['EN'])?.commit as string;
        const path = c.src === 'EN-HIL' ? c.file : `firmware/tinyg/${c.file}`;
        const key = `${commit}:${path}`;
        let lines = cache.get(key);
        if (lines === undefined) {
          try {
            lines = execFileSync('git', ['-C', FIRMWARE as string, 'show', key], { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n');
          } catch {
            problems.push(`${b.id}: ${key} does not exist`);
            continue;
          }
          cache.set(key, lines);
        }
        const window = lines.slice(c.lines[0] - 1, c.lines[1]).join('\n');
        if (!window.includes(c.quote)) problems.push(`${b.id}: ${c.src} ${c.file}:${c.lines[0]}-${c.lines[1]} lacks ${JSON.stringify(c.quote)}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
