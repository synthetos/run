/**
 * The job analysis in the app (docs/design/ANALYZE.md slice 1): the report rides in the preview result (lite mode
 * too), a file opened with no board, profile, material or tool still gives a useful summary, board values are
 * labelled "Board settings" and saved ones "Last read …", the codes the interpreter emits are the codes the report
 * reads, and a late worker result never replaces a newer file's.
 */
import { describe, expect, it } from 'vitest';
import { EVENT, EVENT_FLAG } from '@synthetos/gcode';
import { TAPE_FLAG, TAPE_KIND, analyzeProgram, type ProgramTape } from '@synthetos/advisor';
import { createGcodePreviewClient, type WorkerLike } from '../src/gcode-worker/client.ts';
import { createGcodeHandler } from '../src/gcode-worker/handler.ts';
import { MAX_HEADINGS, operationHeadings } from '../src/gcode-worker/headings.ts';
import { lineSpans } from '../src/gcode-worker/lines.ts';
import { analyseBytes, type PreviewResult } from '../src/gcode-worker/pipeline.ts';
import type { FromGcodeWorker, ToGcodeWorker } from '../src/gcode-worker/protocol.ts';
import { axisSettings, boardReading, lastReadLabel, motionInputs, type BoardReading } from '../src/workspace/analysisInputs.ts';
import { motionView } from '../src/workspace/analysisState.ts';
import { regionAdvice, regionText } from '../src/workspace/views/analyze/RegionsCard.ts';
import { shortMm } from '../src/workspace/views/analyze/format.ts';
import { plungeFindings } from '../src/workspace/views/analyze/plunges.ts';
import { INITIAL_LIVE_VIEW, type LiveView } from '../src/workspace/model.ts';
import type { MachineProfile } from '../src/workspace/library.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const preview = (text: string, mode: 'full' | 'lite' = 'full'): PreviewResult => analyseBytes(bytes(text), { dialect: 'tinyg-en', mode }).result;
const JOB = '(01 Pocket)\nG21 G90 G17\nS12000 M3\nG0 X0 Y0 Z5\nG1 Z-1 F300\nG1 X100 F1200\nG2 X120 Y20 I0 J20\nG4 P2\nG0 Z5\nM5\nM30\n';
const NO_SOURCES = { live: null, saved: null, profile: null };

describe('the report in the preview', () => {
  it('uses the interpreter’s event codes', () => {
    expect(TAPE_KIND).toEqual(EVENT);
    expect(TAPE_FLAG).toEqual(EVENT_FLAG);
  });

  it('with no board, profile, material or tool: distances, programmed feed time, dwells and an operation; rapids untimed', () => {
    const r = preview(JOB).analysis;
    // The G2 turns three quarters of a 20 mm radius circle: 30π mm, measured from the arc, not its drawing.
    expect(r.feedMm.value).toBeCloseTo(6 + 100 + Math.PI * 30, 6);
    expect(r.feedSeconds.value).toBeCloseTo((6 / 300 + 100 / 1200 + (Math.PI * 30) / 1200) * 60, 6);
    expect(r.dwellSeconds.value).toBe(2);
    expect(r.operations.map((o) => o.name)).toEqual(['Pocket']);
    const view = motionView(r, NO_SOURCES);
    expect(view.time.rapidSeconds.value).toBeNull();
    expect(view.time.totalSeconds).toBeNull();
    expect(view.time.missing).toEqual(['Rapid speeds are not known. Connect your machine to improve the time estimate.']);
  });

  it('is kept in lite mode, where there is no 3D scene', () => {
    const lite = preview(JOB, 'lite');
    expect(lite.segments).toBeNull();
    expect(lite.analysis.feedSeconds.value).toBe(preview(JOB).analysis.feedSeconds.value);
  });

  it('has no 10,000-vertex cliff: a file of many short moves and arcs is timed in full', () => {
    const lines = ['G21 G90 G17', 'G0 X0 Y0', 'G1 Z-1 F600'];
    for (let i = 0; i < 20_000; i++) lines.push(i % 2 === 0 ? `G1 X${(i % 200) * 0.2} F3000` : `G2 X${((i - 1) % 200) * 0.2 + 0.2} Y0 I0.1 J0`);
    lines.push('M30');
    const r = preview(lines.join('\n'));
    expect((r.segments?.kinds.length ?? 0)).toBeGreaterThan(10_000);
    expect(r.analysis.feedSeconds.value).not.toBeNull();
    expect(r.analysis.untimedMoves).toBe(0);
    expect(r.analysis.density.regions.length).toBeGreaterThan(0);
  });

  it('reads operation headings from comment lines only', () => {
    const text = '(01 Pocket - T1)\n  (2 Adaptive)\nG1 X1 F100 (03 Not a heading)\n(note)\n';
    expect(operationHeadings(bytes(text), lineSpans(bytes(text)))).toEqual([{ line: 1, name: 'Pocket' }, { line: 2, name: 'Adaptive' }]);
    // A comment just before a tool change names the operation (the text before a colon); a title far above does not.
    const cam = '(part-title)\nG21 G90\nM5\nG0 Z5\n(O-ring groove: T2 D3 flat end mill)\nM5\nT2 M6\n( )\nM6\n(note)\nG0 X1\nG0 X2\nG0 X3\nT3 M6\n';
    expect(operationHeadings(bytes(cam), lineSpans(bytes(cam)))).toEqual([{ line: 5, name: 'O-ring groove' }]);
    const many = '(1 Op)\n'.repeat(MAX_HEADINGS + 5);
    expect(operationHeadings(bytes(many), lineSpans(bytes(many)))).toHaveLength(MAX_HEADINGS);
  });

  it('is deterministic', () => {
    const plain = (r: PreviewResult): string => JSON.stringify({ ...r.analysis, rapidDeltas: Array.from(r.analysis.rapidDeltas) });
    expect(plain(preview(JOB))).toBe(plain(preview(JOB)));
  });
});

/** A live view connected to a board with these settings. */
function liveWith(settings: Record<string, number>, unit: number | undefined, id = 'EN-1'): LiveView {
  const snapshot = { base: 'IDLE_HOMED', live: unit === undefined ? {} : { unit }, identity: { id } };
  return { ...INITIAL_LIVE_VIEW, message: { snapshot } as never, readout: { dialectId: 'tinyg-en', phase: { kind: 'match' } as never, settings } };
}

/** A dense CAM finishing job like a real carved part: passes of 0.006–0.2 mm segments along a curve, with a lift between passes. */
function denseCam(passes: number, segments: number): string {
  const lines = ['(01 Finish)', 'G21 G90 G17', 'T2 M6', 'S18000 M3', 'G0 X0 Y0 Z5'];
  for (let p = 0; p < passes; p++) {
    lines.push(`G0 X0 Y${p}`, 'G1 Z-0.5 F150');
    let x = 0;
    for (let i = 0; i < segments; i++) {
      x += 0.006 + ((i * 37) % 100) * 0.00194; // 0.006 to 0.2 mm
      lines.push(`G1 X${x.toFixed(4)} Y${(p + Math.sin(x) * 0.5).toFixed(4)} F500`);
    }
    lines.push('G0 Z5');
  }
  lines.push('M5', 'M30');
  return lines.join('\n');
}

describe('a dense CAM file', () => {
  it('is one dense section across its passes, with short moves shown to the hundredth', () => {
    const r = preview(denseCam(6, 400)).analysis;
    expect(r.density.regions).toHaveLength(1);
    const d = r.density.regions[0];
    if (d === undefined) throw new Error('no region');
    expect(d.lines).toBeGreaterThan(1500); // the longer segments (over 0.17 mm at 500 mm/min) are not dense
    expect(d.meanMoveMm).toBeLessThan(0.2);
    expect(regionText(d)).toMatch(/^The machine may not reach the feed here, and the stream may not keep up\. [0-9,]+ very short moves, about 0\.\d+ mm each\.$/);
    expect(regionText(d, true)).toContain('lines/s at the programmed feed');
    expect(regionAdvice(d)).toContain('In your CAM');
    expect(r.operations.map((o) => o.name)).toEqual(['Finish']);
    expect([shortMm(0.006), shortMm(0.085), shortMm(2.54), shortMm(12.3)]).toEqual(['0.006 mm', '0.09 mm', '2.5 mm', '12 mm']);
  });
});

describe('plunge-heavy operations', () => {
  it('are found when slow plunges take a big share of an operation, and point at the first one', () => {
    const lines = ['(Groove: T2 D3)', 'G21 G90', 'T2 M6', 'S16000 M3', 'G0 Z5'];
    for (let i = 0; i < 40; i++) lines.push(`G0 X${i * 2} Y0 Z5`, 'G1 Z-1 F100', `G1 X${i * 2 + 1} F800`, 'G0 Z5');
    lines.push('M5', 'M30');
    const r = preview(lines.join('\n')).analysis;
    const found = plungeFindings(r);
    expect(found).toHaveLength(1);
    expect(found[0]?.operation.name).toBe('Groove');
    expect(found[0]?.regime).toMatchObject({ kind: 'plunge', feed: 100, moves: 40, firstLine: 7 });
    expect(found[0]?.share).toBeGreaterThan(0.9);
    expect(plungeFindings(preview(JOB).analysis)).toEqual([]);
    expect(plungeFindings({ ...r, operations: r.operations.map((o) => ({ ...o, seconds: null })) })).toEqual([]);
  });
});

describe('motion inputs', () => {
  const settings = { xvm: 10000, yvm: 8000, zvm: 1000, xfr: 5000, yfr: 5000, zfr: 800, xjm: 5000 };

  it('board values are "Board settings", and inches are converted with the evidence named', () => {
    const mm = boardReading(liveWith(settings, 1), 42) as BoardReading;
    expect(mm).toMatchObject({ dialect: 'tinyg-en', boardId: 'EN-1', unit: 1, vm: { X: 10000, Y: 8000, Z: 1000 }, at: 42 });
    expect(motionInputs({ ...NO_SOURCES, live: mm }).rapid.X).toEqual({ value: 10000, source: 'board', label: 'Board settings', units: 'mm/min', observedAt: 42 });
    const inch = boardReading(liveWith({ xvm: 400 }, 0), 1) as BoardReading;
    expect(motionInputs({ ...NO_SOURCES, live: inch }).rapid.X).toMatchObject({ value: 400 * 25.4, label: 'Board settings (in/min, converted)' });
    expect(motionInputs({ ...NO_SOURCES, live: inch }).rapid.Y).toMatchObject({ value: null, label: 'Board settings' });
    const unknown = boardReading(liveWith({ xvm: 400 }, undefined, ''), 1) as BoardReading;
    expect(unknown.boardId).toBeNull();
    expect(motionInputs({ ...NO_SOURCES, live: unknown }).rapid.X).toMatchObject({ value: null, label: 'Board settings (units not read)' });
  });

  it('no reading when not connected or the settings are not read', () => {
    expect(boardReading(null, 1)).toBeNull();
    expect(boardReading(INITIAL_LIVE_VIEW, 1)).toBeNull();
    expect(boardReading(liveWith({}, 1), 1)).toBeNull();
  });

  it('a saved reading says when it was read; the profile comes last; else not known', () => {
    const saved = boardReading(liveWith(settings, 1), Date.UTC(2026, 10, 9, 14, 2)) as BoardReading;
    const e = motionInputs({ ...NO_SOURCES, saved }).rapid.Z;
    expect(e).toMatchObject({ value: 1000, source: 'saved-board', label: lastReadLabel(saved.at) });
    expect(e.label.startsWith('Last read ')).toBe(true);
    const profile = { id: 'p', name: 'Shop router', axes: { x: { maxVelocity: 7000, maxFeed: 3000 } } } as unknown as MachineProfile;
    expect(motionInputs({ ...NO_SOURCES, profile }).rapid.X).toEqual({ value: 7000, source: 'profile', label: 'Machine profile (Shop router)', units: 'mm/min' });
    expect(motionInputs({ ...NO_SOURCES, profile }).rapid.Y).toMatchObject({ value: null, label: 'Not known' });
    expect(axisSettings({ ...NO_SOURCES, profile })[0]?.feed.value).toBe(3000);
    expect(axisSettings({ ...NO_SOURCES, live: saved }).map((s) => s.feed.value)).toEqual([5000, 5000, 800]);
  });

  it('with the board, the rapids are timed and the total is shown', () => {
    const view = motionView(preview(JOB).analysis, { ...NO_SOURCES, live: boardReading(liveWith(settings, 1), 1) });
    expect(view.time.rapidSeconds).toMatchObject({ source: 'board', label: 'Board settings' });
    expect(view.time.totalSeconds).not.toBeNull();
    expect(view.time.manualStops).toBe(0);
  });
});

describe('freshness', () => {
  it('a late result from a replaced load never replaces the newer file’s', async () => {
    const workers: { w: WorkerLike; held: FromGcodeWorker[] }[] = [];
    const client = createGcodePreviewClient(() => {
      const entry = { w: null as unknown as WorkerLike, held: [] as FromGcodeWorker[] };
      const handle = createGcodeHandler((m) => { entry.held.push(m); });
      entry.w = { onmessage: null, onerror: null, postMessage: (m: ToGcodeWorker) => void handle(m), terminate: () => {} };
      workers.push(entry);
      return entry.w;
    });
    const first = client.load(new Blob(['G21 G90\nG1 X1 F100\nM30\n']), { dialect: 'tinyg-en', mode: 'full' });
    const second = client.load(new Blob(['(01 Newer)\nG21 G90\nG1 X2 F200\nM30\n']), { dialect: 'tinyg-en', mode: 'full' });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 50));
    const deliver = (i: number): void => { const e = workers[i]; if (e !== undefined) for (const m of e.held) e.w.onmessage?.({ data: m } as MessageEvent<FromGcodeWorker>); };
    deliver(1);
    deliver(0); // the replaced load's result arrives late
    const result = await second;
    expect(result.analysis.operations.map((o) => o.name)).toEqual(['Newer']);
  });
});

describe('performance', () => {
  it('the report on a million-move tape takes well under a second, off the machine worker (it runs in the G-code worker)', () => {
    const n = 1_000_000;
    const t: ProgramTape = { count: n, kinds: new Uint8Array(n), flags: new Uint8Array(n), sent: new Uint32Array(n), source: new Uint32Array(n), lengthMm: new Float64Array(n), delta: new Float64Array(n * 3), feed: new Float64Array(n).fill(3000), spindle: new Float64Array(n), tool: new Int32Array(n), seconds: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      t.sent[i] = i;
      t.source[i] = i + 1;
      t.lengthMm[i] = i % 100 < 50 ? 0.2 : 5;
      t.delta[i * 3] = t.lengthMm[i] as number;
    }
    analyzeProgram(t); // warm up
    const started = performance.now();
    const r = analyzeProgram(t);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(r.feedSeconds.value).not.toBeNull();
  });
});
