/**
 * Differential test against EN-HIL's reference path simulator, gsim.py
 * (ROADMAP TB-02, RUN_PLAN §8.3). `differential/gsim-expected.json` holds
 * gsim's answer for every corpus file (regenerate with
 * `differential/gsim_expected.py`); this test runs run's sanitiser and
 * interpreter over the same files and compares the position after every sent
 * line and the box of the whole path. Every disagreement must be triaged in
 * `differential/triage.json`; a new one, or a triaged one that went away,
 * fails the test so the triage stays current.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TINYG_EN } from '@synthetos/protocol';
import { analyse } from './helpers.ts';

const DIR = new URL('./differential/', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('gsim-expected.json', DIR), 'utf8')) as {
  files: Record<string, { positions: Array<[number, number, number]>; box: { min: number[]; max: number[] } | null }>;
};
const triage = JSON.parse(readFileSync(new URL('triage.json', DIR), 'utf8')) as Record<string, { lines: number[]; box: boolean; reason: string }>;

/** Positions: float32 vertices, so 1 µm. Boxes: gsim tessellates at ~0.1 mm chords and so sits inside the exact box. */
const POSITION_MM = 1e-3;
const BOX_MM = 0.01;

function compare(name: string): { lines: number[]; box: boolean } {
  const text = readFileSync(new URL(`corpus/${name}`, DIR), 'latin1');
  const { sanitized, analysis } = analyse(text, TINYG_EN, { sanitize: { c14: true, c22: true } });
  const gsim = expected.files[name];
  if (gsim === undefined) throw new Error(`${name} has no gsim result: regenerate gsim-expected.json`);
  const lines: number[] = [];
  let pos: [number, number, number] = [0, 0, 0];
  const after = new Map<number, [number, number, number]>();
  sanitized.lines.forEach((l, i) => {
    const end = analysis.lineToVertex[i + 1] as number;
    if (end > (analysis.lineToVertex[i] as number)) {
      pos = [analysis.vertices[(end - 1) * 3] as number, analysis.vertices[(end - 1) * 3 + 1] as number, analysis.vertices[(end - 1) * 3 + 2] as number];
    }
    after.set(l.sourceLine, pos);
  });
  for (const [line, ours] of after) {
    const theirs = gsim.positions[line - 1] as [number, number, number];
    if (ours.some((v, k) => Math.abs(v - (theirs[k] as number)) > POSITION_MM)) lines.push(line);
  }
  let box = false;
  const b = analysis.bounds;
  if ((b === null) !== (gsim.box === null)) box = true;
  else if (b !== null && gsim.box !== null) {
    for (let k = 0; k < 3; k++) {
      const gmin = gsim.box.min[k] as number;
      const gmax = gsim.box.max[k] as number;
      if (b.min[k]! > gmin + POSITION_MM || b.max[k]! < gmax - POSITION_MM || gmin - b.min[k]! > BOX_MM || b.max[k]! - gmax > BOX_MM) box = true;
    }
  }
  return { lines, box };
}

describe('differential: run interpreter vs gsim.py over the corpus', () => {
  const files = readdirSync(fileURLToPath(new URL('corpus/', DIR))).sort();

  it('has a gsim result for every corpus file and a triage entry only for corpus files', () => {
    expect(Object.keys(expected.files).sort()).toEqual(files);
    for (const name of Object.keys(triage)) expect(files).toContain(name);
  });

  for (const name of files) {
    it(name, () => {
      const got = compare(name);
      const t = triage[name];
      expect({ lines: got.lines, box: got.box }).toEqual({ lines: t?.lines ?? [], box: t?.box ?? false });
    });
  }
});
