/**
 * ROADMAP P0-07 fixture acceptance:
 * - every JSON example in PROTOCOL_NOTES (test/fixtures/pnExamples.ts);
 * - the forum topics' sr/qr/r/er lines with source URLs (test-fixtures/forum-json/);
 * - EN-HIL transcript snippets for both banner shapes and all three footer
 *   revisions (test-fixtures/en-hil/);
 * - relaxed `{er:{...}}`.
 */
import { describe, expect, it } from 'vitest';
import { classifyLine } from '../src/classify.ts';
import { decodeInbound } from '../src/inbound.ts';
import type { ClassifiedLine } from '../src/types.ts';
import { PN_CONCRETE, PN_VERBATIM } from './fixtures/pnExamples.ts';
import { readFixture, readFixtureDir, FIXTURES } from './fixtures/rows.ts';
import { join } from 'node:path';

const forum = readFixtureDir('forum-json');
const enHil = readFixtureDir('en-hil');

function describeRow(file: string, lineNo: number): string {
  return `${file.slice(FIXTURES.length + 1)}:${lineNo}`;
}

describe('PROTOCOL_NOTES examples', () => {
  it('lists all 20 distinct JSON spans PN quotes, each classified as expected', () => {
    expect(PN_VERBATIM).toHaveLength(20);
    expect(new Set(PN_VERBATIM.map((e) => e.line)).size).toBe(20);
    for (const e of [...PN_VERBATIM, ...PN_CONCRETE]) {
      const c = classifyLine(e.line);
      expect(c.kind, e.where).toBe(e.kind);
      if (e.reason !== undefined) expect(c.kind === 'Garbled' && c.reason, e.where).toBe(e.reason);
    }
  });

  it('host-to-board commands quoted in PN are never mistaken for board output', () => {
    for (const e of PN_VERBATIM.filter((x) => x.where.includes('(command'))) {
      expect(classifyLine(e.line).kind, e.where).toBe('Garbled');
    }
  });
});

describe('forum fixtures', () => {
  it('cover at least the 29 topics the plan names, each with its source URL', () => {
    expect(forum.length).toBeGreaterThanOrEqual(29);
    for (const f of forum) {
      expect(f.comments.some((c) => /^# source: https:\/\/synthetos\.com\/topics\/[a-z0-9_-]+\/$/.test(c)), f.file).toBe(true);
      expect(f.rows.length, f.file).toBeGreaterThan(0);
    }
  });

  it('contain real sr, qr, r and er lines, in strict and relaxed syntax, and both footer placements', () => {
    const rows = forum.flatMap((f) => f.rows);
    for (const kind of ['Response', 'StatusReport', 'QueueReport', 'Exception', 'Banner', 'Garbled']) {
      expect(rows.some((r) => r.kind === kind), kind).toBe(true);
    }
    const responses = rows.map((r) => classifyLine(r.line)).filter((c) => c.kind === 'Response');
    expect(responses.some((c) => c.kind === 'Response' && c.footerPlacement === 'nested')).toBe(true);
    expect(responses.some((c) => c.kind === 'Response' && c.footer.checksum !== undefined)).toBe(true);
  });

  it('classify every row as its reviewed kind', () => {
    for (const f of forum) {
      for (const r of f.rows) expect(classifyLine(r.line).kind, describeRow(r.file, r.lineNo)).toBe(r.kind);
    }
  });
});

describe('EN-HIL fixtures', () => {
  const harness = readFixture(join(FIXTURES, 'en-hil/harness-lines.txt'));
  const transcript = readFixture(join(FIXTURES, 'en-hil/e031-limit-stop.txt'));

  it('classify every row as expected', () => {
    for (const f of enHil) {
      for (const r of f.rows) expect(classifyLine(r.line).kind, describeRow(r.file, r.lineNo)).toBe(r.kind);
    }
  });

  it('include both banner shapes and all three footer revisions', () => {
    const classified: ClassifiedLine[] = enHil.flatMap((f) => f.rows.map((r) => classifyLine(r.line)));
    const shapes = new Set(classified.flatMap((c) => (c.kind === 'Banner' ? [c.shape] : [])));
    expect([...shapes].sort()).toEqual(['bare-sr', 'r-footer']);
    const revs = new Set(classified.flatMap((c) => (c.kind === 'Response' ? [c.footer.rev] : [])));
    expect([...revs].sort()).toEqual([1, 2, 3]);
  });

  it('decode the E031 bench transcript as a byte stream, in order, exactly as the harness classified it', () => {
    const stream = new TextEncoder().encode(transcript.rows.map((r) => `${r.line}\r\n`).join(''));
    const events = decodeInbound([stream]);
    expect(events.map((e) => e.kind)).toEqual(transcript.rows.map((r) => r.kind));
    // The limit-hit exception and the following alarm state are in the transcript.
    expect(events.some((e) => e.kind === 'Exception' && e.st === 203)).toBe(true);
  });

  it('extract tid only at the top level, as EN-HIL test_e049 requires', () => {
    const withTid = harness.rows.map((r) => classifyLine(r.line)).filter((c) => c.kind === 'Response' && c.tid !== undefined);
    expect(withTid.map((c) => c.kind === 'Response' && c.tid).sort((a, b) => Number(a) - Number(b))).toEqual([
      5, 9, 17, 33, 4294967295,
    ]);
  });
});

describe('relaxed exception reports', () => {
  it('classifies relaxed {er:{...}} from TG and EN', () => {
    expect(classifyLine('{er:{fb:440.21,st:204,msg:"Limit switch hit - Shutdown occurred"}}')).toMatchObject({
      kind: 'Exception',
      st: 204,
      fb: 440.21,
      msg: 'Limit switch hit - Shutdown occurred',
    });
    expect(classifyLine('{er:{fb:449.01,st:204,msg:"Command rejected by ALARM [$clear to reset] - \\u0007"}}')).toMatchObject({
      kind: 'Exception',
      msg: 'Command rejected by ALARM [$clear to reset] - \u0007',
    });
  });
});
