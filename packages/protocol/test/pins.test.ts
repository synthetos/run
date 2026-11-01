/**
 * PIN-1 (PROTOCOL_NOTES §15): every firmware citation in protocol code is
 * pinned to a commit recorded in `vendor/firmware-pins.json`.
 *
 * The citations' line numbers were checked against the pinned sources when
 * they were written (the firmware repositories are not available in CI).
 * What CI can hold is the pinning itself: every `@cite` tag is a known,
 * pinned source, and every place that names a pinned commit names the same
 * one, so a firmware bump that re-pins one file but not another fails here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(import.meta.dirname, '../../..');
const SRC = join(REPO, 'packages/protocol/src');

interface Pin {
  repo: string;
  ref: string;
  commit: string;
  fb?: number;
}
const pins = (JSON.parse(readFileSync(join(REPO, 'vendor/firmware-pins.json'), 'utf8')) as { pins: Record<string, Pin> }).pins;

/** Tags that are not separately pinned: MOT lives in the G2 tree; OLD-PN is the design's own document. */
const DERIVED_TAGS: Record<string, string | null> = { MOT: 'G2', 'OLD-PN': null };

function sources(): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(join(SRC, f), 'utf8')]);
}

describe('PIN-1: firmware pins', () => {
  it('pins every source tag to a full commit', () => {
    expect(Object.keys(pins).sort()).toEqual(['EN', 'G2', 'G2W', 'S449', 'TG']);
    for (const [tag, pin] of Object.entries(pins)) {
      expect(pin.commit, tag).toMatch(/^[0-9a-f]{40}$/);
      expect(pin.repo, tag).toMatch(/^https:\/\/github\.com\/synthetos\//);
    }
  });

  it('pins the edge-next commit that reports fb 450.01 and the 440.21 release', () => {
    expect(pins['EN']?.commit.startsWith('ead63997')).toBe(true);
    expect(pins['EN']?.fb).toBe(450.01);
    expect(pins['TG']?.fb).toBe(440.21);
    expect(pins['S449']?.fb).toBe(449.01);
  });

  it('every @cite tag in protocol source is pinned (or derived from a pinned tree)', () => {
    for (const [file, text] of sources()) {
      for (const m of text.matchAll(/@cite ([A-Za-z0-9-]+)/g)) {
        const tag = m[1] as string;
        const known = tag in pins || (tag in DERIVED_TAGS && (DERIVED_TAGS[tag] === null || (DERIVED_TAGS[tag] as string) in pins));
        expect(known, `${file}: @cite ${tag}`).toBe(true);
      }
    }
  });

  it('every short commit a source file names for a tag is that tag’s pinned commit', () => {
    const named = /\b(EN|TG|S449|G2|G2W)\b[^\n]*?@ ([0-9a-f]{7,40})\b/g;
    let checked = 0;
    for (const [file, text] of sources()) {
      for (const m of text.matchAll(named)) {
        const [, tag, sha] = m as unknown as [string, string, string];
        expect(pins[tag]?.commit.startsWith(sha), `${file}: ${tag} @ ${sha}`).toBe(true);
        checked++;
      }
    }
    // index.ts names all five; a regex that matched nothing would prove nothing.
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('each dialect file names the commit its citations are pinned to', () => {
    const expectations: [string, string][] = [
      ['dialects/tinygEn.ts', 'EN'],
      ['dialects/tinyg440.ts', 'TG'],
      ['dialects/tinyg449Stock.ts', 'S449'],
      ['dialects/g2core.ts', 'G2'],
    ];
    for (const [file, tag] of expectations) {
      const text = readFileSync(join(SRC, file), 'utf8');
      const short = (pins[tag] as Pin).commit.slice(0, 7);
      expect(text, file).toContain(short);
    }
  });
});
