/**
 * T-S2 with the EN and TG additions (ROADMAP P0-10, SAFETY §10): the CAM
 * corpus in test-fixtures/cam/, each file's expected outcome on tinyg-en and
 * tinyg-440.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TINYG_440, TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { blocks, bodies, corpus, run } from './sanitizeHelpers.ts';

const BOTH = [TINYG_EN, TINYG_440] as const;

describe('T-S2: CAM corpus', () => {
  it('has at least the 14 cases ROADMAP P0-10 lists', () => {
    const dir = fileURLToPath(new URL('../../../test-fixtures/cam/', import.meta.url));
    expect(readdirSync(dir).filter((f) => f.endsWith('.nc')).length).toBeGreaterThanOrEqual(14);
  });

  it('drops % tape markers and sends nothing with %', () => {
    for (const d of BOTH) {
      const r = run(corpus('01-tape-markers.nc'), d);
      expect(r.report.blocked, d.id).toBe(false);
      expect(r.report.entries.filter((e) => e.rule === 'dropped-tape-marker').map((e) => e.line)).toEqual([1, 6]);
      expect(r.lines.some((l) => l.text.includes('%'))).toBe(false);
      expect(bodies(r)).toEqual(['G90 G94 G17 G21 G54', 'G0 X10 Y10', 'G1 X20 F600']);
    }
  });

  it('strips "(50% stepover)" and a trailing comment with % instead of rejecting the line', () => {
    for (const d of BOTH) {
      const r = run(corpus('02-percent-in-comment.nc'), d);
      expect(r.report.blocked, d.id).toBe(false);
      expect(bodies(r)).toEqual(['G90 G94 G17 G21 G54', 'G0 X5 Y5', 'G1 Z-1 F300']);
    }
  });

  it('strips "(TOOL CHANGE!)"', () => {
    for (const d of BOTH) {
      const r = run(corpus('03-bang-in-comment.nc'), d);
      expect(r.report.blocked, d.id).toBe(false);
      expect(r.lines.some((l) => l.text.includes('!'))).toBe(false);
      expect(bodies(r)).toEqual(['G90 G94 G17 G21 G54', 'G0 X1 Y1']);
    }
  });

  it('rejects an embedded 0x18', () => {
    for (const d of BOTH) {
      const r = run(corpus('04-embedded-ctrl-x.nc'), d);
      expect(blocks(r), d.id).toEqual(['control-byte']);
      expect(r.report.entries.find((e) => e.rule === 'control-byte')?.line).toBe(2);
      expect(r.lines.some((l) => l.text.includes('\x18'))).toBe(false);
    }
  });

  it('rejects a 130-byte line on TinyG', () => {
    for (const d of BOTH) {
      const r = run(corpus('05-line-130-bytes.nc'), d);
      expect(blocks(r), d.id).toEqual(['too-long']);
      expect(r.lines.every((l) => l.text.length <= 120)).toBe(true);
    }
  });

  it.each([
    ['06-dollar-h.nc', 1],
    ['07-question-mark.nc', 2],
    ['08-leading-h.nc', 2],
  ])('rejects %s as a controller command (line %i)', (file, line) => {
    for (const d of BOTH) {
      const r = run(corpus(file), d);
      expect(blocks(r), d.id).toEqual(['first-character']);
      expect(r.report.entries.find((e) => e.rule === 'first-character')?.line).toBe(line);
    }
  });

  it('rejects M100 and G38.2 on every dialect', () => {
    for (const d of BOTH) {
      expect(blocks(run(corpus('09-m100.nc'), d)), d.id).toEqual(['m100']);
      expect(blocks(run(corpus('10-probe-g38.nc'), d)), d.id).toEqual(['probe']);
    }
  });

  it('sends a CRLF file as LF-only lines with no CR', () => {
    for (const d of BOTH) {
      const r = run(corpus('11-crlf.nc'), d);
      expect(r.report.blocked, d.id).toBe(false);
      expect(r.lines.some((l) => /[\r\n]/.test(l.text))).toBe(false);
      expect(bodies(r)).toEqual(['G90 G94 G17 G21 G54', 'G0 X10 Y10', 'G1 Z-1 F300', 'G1 X20', 'M30']);
      expect(r.lines.at(-1)?.holdback).toBe(true);
    }
  });

  it('G18 arcs: EN sends the EN-HIL e029 arc; TG blocks it (E029)', () => {
    const en = run(corpus('12-g18-arc.nc'), TINYG_EN);
    expect(en.report.blocked).toBe(false);
    expect(bodies(en)).toContain('G18 G91 G2 X2 Z0 I1 K0.75 F120');
    const tg = run(corpus('12-g18-arc.nc'), TINYG_440);
    expect(blocks(tg)).toEqual(['g18-arc']);
  });

  it('G10 L20: EN sets the offset at the current position; TG blocks it', () => {
    const en = run(corpus('13-g10-l20.nc'), TINYG_EN);
    expect(en.report.blocked).toBe(false);
    // X reads 0 after L20 at machine X0, so G0 X5 is a 5 mm move.
    expect(en.lines.find((l) => l.body === 'G0 X5')?.motion?.plannerLength).toBe(5);
    expect(blocks(run(corpus('13-g10-l20.nc'), TINYG_440))).toEqual(['l-word']);
  });

  it('a mid-file M30 blocks on EN and warns on TG; the final M30 is held back', () => {
    const en = run(corpus('14-mid-file-m30.nc'), TINYG_EN);
    expect(blocks(en)).toEqual(['mid-file-program-end']);
    expect(en.report.entries.find((e) => e.rule === 'mid-file-program-end')?.line).toBe(3);
    const tg = run(corpus('14-mid-file-m30.nc'), TINYG_440);
    expect(tg.report.blocked).toBe(false);
    expect(tg.report.entries.filter((e) => e.rule === 'mid-file-program-end').map((e) => e.severity)).toEqual(['warn']);
    expect(tg.lines.map((l) => l.holdback)).toEqual([false, false, false, false, true]);
  });

  it('M201.3 blocks on EN (and on TG, where it is also parsed)', () => {
    expect(blocks(run(corpus('15-m201-3.nc'), TINYG_EN))).toEqual(['m201.3']);
    expect(blocks(run(corpus('15-m201-3.nc'), TINYG_440))).toEqual(['unsupported-code']);
  });

  it('"S1000 T1 M6 M3 M8 G4 P1": TG blocks it (E088) even with C14; EN passes it (a manual tool-change stop, H74)', () => {
    expect(blocks(run(corpus('16-e088-queued.nc'), TINYG_440))).toEqual(['m6-without-c14', 'e088-queued-per-line']);
    expect(blocks(run(corpus('16-e088-queued.nc'), TINYG_440, { c14: true }))).toEqual(['e088-queued-per-line']);
    expect(blocks(run(corpus('16-e088-queued.nc'), TINYG_EN))).toEqual([]);
    expect(run(corpus('16-e088-queued.nc'), TINYG_EN, { c14: true }).report.blocked).toBe(false);
  });

  it('"N10 (c) G0X10" and "(c) G0X10" are rejected, never sent as G0X10', () => {
    for (const d of BOTH) {
      const r = run(corpus('17-comment-then-code.nc'), d);
      expect(blocks(r), d.id).toEqual(['text-after-comment', 'text-after-comment']);
      expect(r.report.entries.filter((e) => e.severity === 'block').map((e) => e.line)).toEqual([2, 3]);
      expect(r.lines.some((l) => l.body.replace(/\s/g, '') === 'G0X10')).toBe(false);
    }
  });

  it('M6 is rejected without C14 on 440.21 and a tool-change stop on EN; with C14 it is preceded by M5, M9, M0 and the M0 is a barrier', () => {
    expect(blocks(run(corpus('18-m6-tool-change.nc'), TINYG_440))).toEqual(['m6-without-c14']);
    expect(blocks(run(corpus('18-m6-tool-change.nc'), TINYG_EN))).toEqual([]);
    for (const d of BOTH) {
      const r = run(corpus('18-m6-tool-change.nc'), d, { c14: true });
      expect(r.report.blocked).toBe(false);
      expect(bodies(r).slice(1, 5)).toEqual(['M5', 'M9', 'M0', 'T2 M6']);
      expect(r.lines.slice(1, 5).map((l) => [l.origin, l.barrier])).toEqual([
        ['c14', false],
        ['c14', false],
        ['c14', true],
        ['file', false],
      ]);
    }
  });

  it('a clean CAM job passes on both dialects with C14, numbered 1..n, final M30 held back', () => {
    for (const d of BOTH) {
      const r = run(corpus('19-clean-job.nc'), d, { c14: true });
      expect(r.report.blocked, d.id).toBe(false);
      expect(r.lines.map((l) => l.n)).toEqual(r.lines.map((_, i) => i + 1));
      expect(r.lines.every((l) => l.text === `N${l.n} ${l.body}`)).toBe(true);
      expect(r.lines.filter((l) => l.holdback).map((l) => l.body)).toEqual(['M30']);
      expect(r.lines.at(-1)?.holdback).toBe(true);
      expect(r.report.entries.filter((e) => e.rule === 'n-word-stripped')).toHaveLength(13);
      expect(r.report.endState).toEqual({ spindle: 'off', mist: false, flood: false });
    }
  });
});
