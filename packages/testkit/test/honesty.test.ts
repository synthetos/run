/**
 * The honesty rule (RUN_PLAN §8.1): every behaviour a safety claim depends on
 * carries @cite and @status; STATUS.md is generated and lists the UNVERIFIED
 * ones. This file holds the register to that rule:
 * - the register is well formed;
 * - each behaviour is implemented where the source says (`@behaviour <id>`)
 *   and every such tag is registered;
 * - each behaviour has at least one test whose title carries `[<id>]`;
 * - STATUS.md is exactly what the register renders.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEHAVIOURS, MODEL_LIMITS } from '../src/honesty/behaviours.ts';
import { renderStatus, validateBehaviours } from '../src/honesty/status.ts';
import type { Behaviour } from '../src/honesty/types.ts';

const PKG = resolve(import.meta.dirname, '..');
const read = (dir: string): string =>
  readdirSync(join(PKG, dir))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(PKG, dir, f), 'utf8'))
    .join('\n');

const ids = BEHAVIOURS.map((b) => b.id);

describe('behaviour register', () => {
  it('is well formed', () => {
    expect(validateBehaviours(BEHAVIOURS)).toEqual([]);
    expect(BEHAVIOURS.filter((b) => b.model === 'tinyg-en').length).toBeGreaterThan(30);
    expect(BEHAVIOURS.filter((b) => b.model === 'tinyg-440').length).toBeGreaterThan(20);
  });

  it('validation catches the mistakes it exists for', () => {
    const base: Behaviour = BEHAVIOURS[0] as Behaviour;
    const broken: Behaviour[] = [
      { ...base, id: 'bad id' },
      { ...base, cites: [] },
      { ...base, id: 'EN-X', status: 'UNVERIFIED', bench: undefined as unknown as string },
      { ...base, id: 'EN-Y', status: 'verified-bench', bench: 'B-QR-1' },
      { ...base, id: 'EN-Z', cites: [{ src: 'TG', file: 'x.c', lines: [3, 1], quote: '' }] },
      { ...base, id: 'TG-W', model: 'tinyg-en' },
      base,
    ];
    const problems = validateBehaviours([base, ...broken]);
    for (const needle of ['id must look like', 'no citation', 'UNVERIFIED needs', 'verified-bench needs', 'bad line range', 'empty quote', 'cites 440.21 source', 'does not match model', 'duplicate id']) {
      expect(problems.some((p) => p.includes(needle)), needle).toBe(true);
    }
  });

  it('every behaviour is tagged in the model source, and every tag is registered', () => {
    const src = read('src/firmware');
    const tags = new Set([...src.matchAll(/@behaviour ((?:EN|TG)-[A-Z0-9-]+)/g)].map((m) => m[1] as string));
    expect(ids.filter((id) => !tags.has(id))).toEqual([]);
    expect([...tags].filter((t) => !ids.includes(t))).toEqual([]);
  });

  it('every behaviour has a test whose title carries its id', () => {
    const tests = read('test');
    const titled = new Set([...tests.matchAll(/it\(\s*'\[((?:EN|TG)-[A-Z0-9-]+)\]/g)].map((m) => m[1] as string));
    expect(ids.filter((id) => !titled.has(id))).toEqual([]);
  });

  it('STATUS.md is the generated rendering of the register (run gen:status after a change)', () => {
    const committed = readFileSync(join(PKG, 'STATUS.md'), 'utf8');
    expect(committed).toBe(renderStatus(BEHAVIOURS, MODEL_LIMITS));
  });

  it('STATUS.md lists every UNVERIFIED behaviour in its release-checklist section with the bench task', () => {
    const status = renderStatus(BEHAVIOURS, MODEL_LIMITS);
    const section = status.split('## UNVERIFIED (release checklist)')[1]?.split('\n## ')[0] ?? '';
    const unverified = BEHAVIOURS.filter((b) => b.status === 'UNVERIFIED');
    expect(unverified.length).toBeGreaterThan(0);
    for (const b of unverified) {
      expect(section).toContain(`| ${b.id} | UNVERIFIED |`);
      expect(section).toContain(b.bench as string);
    }
    expect(section).not.toContain('verified-source');
  });
});
