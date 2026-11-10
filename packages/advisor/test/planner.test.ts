/**
 * The planner model against TG Firmware's ground truth (docs/design/ANALYZE.md slice 2; test/fixtures/planner-timing):
 * the real TinyG 450.02 planner, exec and segment prep replayed on the host, for 21 fixtures and two machine
 * profiles. Each fixture goes through run's own sanitiser and interpreter, as a job would, and the model times the
 * event tape. Per fixture: total time within 2%, the exit limit of each block at 95% or better, and the head, body
 * and tail split close. With PLANNER_TABLE set to a path, the table is written there for the report.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlannedBlock, PlannerProfile } from '../src/index.ts';
import { DIR, planFixture, profileOf, type ResultBlock, type ResultFile, type Results } from './plannerFixtures.ts';

interface Row {
  readonly fixture: string;
  readonly profile: string;
  readonly truth: number;
  readonly model: number | null;
  readonly errorPct: number | null;
  readonly exitAgree: number | null;
  readonly splitErr: number | null;
  readonly note: string;
}

const moves = (blocks: readonly ResultBlock[]): ResultBlock[] => blocks.filter((b) => b.kind !== 'dwell');

/**
 * Blocks are compared line by line. TG's report joins consecutive blocks of one line whose plans are bit-for-bit
 * equal into one record (planner_timing.py: "a new block when either changes"), so a line can hold fewer records
 * there than blocks here: per line, the exit limits are matched as counts, and head, body and tail as sums.
 */
function byLine<T>(blocks: readonly T[], n: (b: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const b of blocks) out.set(n(b), [...(out.get(n(b)) ?? []), b]);
  return out;
}

function compare(file: ResultFile, profileName: string, text: string, profile: PlannerProfile): Row {
  const truth = file.host.duration_s;
  const plan = planFixture(text, profile);
  if (!plan.ok) return { fixture: file.name, profile: profileName, truth, model: null, errorPct: null, exitAgree: null, splitErr: null, note: plan.reason };
  const model = plan.result.seconds;
  const t = byLine(moves(file.host.blocks), (b) => b.n);
  const m = byLine(plan.result.blocks.filter((b) => b.kind !== 'dwell'), (b: PlannedBlock) => b.n);
  let agree = 0;
  let total = 0;
  let split = 0;
  for (const n of new Set([...t.keys(), ...m.keys()])) {
    const a = t.get(n) ?? [];
    const b = m.get(n) ?? [];
    const counts = new Map<string, number>();
    for (const x of a) counts.set(x.exit_limit ?? '', (counts.get(x.exit_limit ?? '') ?? 0) + 1);
    for (const y of b) {
      const left = counts.get(y.exitLimit ?? '') ?? 0;
      if (left > 0) {
        agree++;
        counts.set(y.exitLimit ?? '', left - 1);
      }
    }
    total += Math.max(a.length, b.length);
    const sum = (xs: readonly number[]): number => xs.reduce((p, v) => p + v, 0);
    split += Math.abs(sum(a.map((x) => x.head_s ?? 0)) - sum(b.map((y) => y.headS))) + Math.abs(sum(a.map((x) => x.body_s ?? 0)) - sum(b.map((y) => y.bodyS))) + Math.abs(sum(a.map((x) => x.tail_s ?? 0)) - sum(b.map((y) => y.tailS)));
  }
  const tCount = [...t.values()].reduce((p, v) => p + v.length, 0);
  const mCount = [...m.values()].reduce((p, v) => p + v.length, 0);
  const note = tCount === mCount ? '' : `TG joins ${mCount - tCount} equal blocks in its report`;
  return { fixture: file.name, profile: profileName, truth, model, errorPct: ((model - truth) / truth) * 100, exitAgree: total === 0 ? 1 : agree / total, splitErr: truth === 0 ? 0 : split / truth, note };
}

/** Every fixture of both profiles (fixture 21 only when PLANNER_FIXTURE_21 points at TG's local copy). */
function conformance(): Row[] {
  const rows: Row[] = [];
  for (const name of readdirSync(`${DIR}results`).sort()) {
    const results = JSON.parse(readFileSync(`${DIR}results/${name}`, 'utf8')) as Results;
    const profile = profileOf(results.profile);
    for (const file of results.files) rows.push(compare(file, results.profile.name, readFileSync(`${DIR}nc/${file.name}`, 'utf8'), profile));
  }
  return rows;
}

function table(rows: readonly Row[]): string {
  const f = (v: number | null, d = 2): string => (v === null ? '—' : v.toFixed(d));
  return ['| Fixture | Profile | TG s | Model s | Error % | Exit agree | Split err | Note |', '|---|---|---:|---:|---:|---:|---:|---|',
    ...rows.map((r) => `| ${r.fixture} | ${r.profile} | ${f(r.truth, 3)} | ${f(r.model, 3)} | ${f(r.errorPct)} | ${r.exitAgree === null ? '—' : `${(r.exitAgree * 100).toFixed(0)}%`} | ${r.splitErr === null ? '—' : `${(r.splitErr * 100).toFixed(1)}%`} | ${r.note} |`)].join('\n');
}

describe('the planner model against TinyG 450.02', () => {
  it('uses the fixtures exactly as copied (SOURCES.md hashes)', () => {
    const listed = [...readFileSync(`${DIR}SOURCES.md`, 'utf8').matchAll(/^([0-9a-f]{64}) {2}\.\/(\S+)$/gm)];
    expect(listed.length).toBe(21 + 2 + 2);
    for (const [, hash, path] of listed) expect(createHash('sha256').update(readFileSync(`${DIR}${path as string}`)).digest('hex'), path).toBe(hash);
  });

  it('times every fixture within 2%, the exit limits at 95% or better, and the head, body and tail split within 2%', () => {
    const rows = conformance();
    const out = process.env['PLANNER_TABLE'];
    if (out !== undefined) writeFileSync(out, `${table(rows)}\n`);
    for (const r of rows.filter((x) => x.model !== null)) {
      expect(Math.abs(r.errorPct as number), `${r.fixture} ${r.profile}`).toBeLessThan(2);
      expect(r.exitAgree as number, `${r.fixture} ${r.profile}`).toBeGreaterThanOrEqual(0.95);
      expect(r.splitErr as number, `${r.fixture} ${r.profile}`).toBeLessThan(0.02);
    }
  });

  it('times fixture 21 (dense CAM excerpt) when TG’s local copy is given', () => {
    const local = process.env['PLANNER_FIXTURE_21'];
    if (local === undefined || !existsSync(local)) return;
    const results = JSON.parse(readFileSync(process.env['PLANNER_RESULTS_21'] ?? '', 'utf8')) as Results;
    const file = results.files.find((f) => f.name.startsWith('21_')) as ResultFile;
    const row = compare(file, results.profile.name, readFileSync(local, 'utf8'), profileOf(results.profile));
    const out = process.env['PLANNER_TABLE_21'];
    if (out !== undefined) writeFileSync(out, `${table([row])}\n`);
    expect(Math.abs(row.errorPct ?? 100)).toBeLessThan(2);
  });
});
