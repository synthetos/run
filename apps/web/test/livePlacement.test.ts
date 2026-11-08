/**
 * The job placed by the live machine (preview/livePlacement.ts): a board whose position is not established
 * never moves the job (it is drawn as planned, the tool from its work position); once homed or set, the stock
 * and clamps follow the work zero in X and Y only, the path by all of it, and the notes say what moved. A file
 * with its own G92: the work position is mapped into the path's frame at the line the board reports
 * (pathFrame.ts), so the tool stays on the segment it is cutting.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { SceneSolid } from '@synthetos/gcode-view';
import { sampleFixture, type MachineProfile } from '../src/workspace/library.ts';
import { newDraftJob, withMachine, withSetup, type Job, type JobClock } from '../src/workspace/jobModel.ts';
import { jobScene, type JobScene } from '../src/preview/sceneModel.ts';
import { g92Note, liveTool, placeJobAt, placeLive, positionEstablished, UNSET_NOTE, UNTRUSTED_NOTE, type LiveReport } from '../src/preview/livePlacement.ts';
import { analyseBytes } from '../src/gcode-worker/pipeline.ts';
import { frameLine, livePathFrame, PLANNED_FRAME, type FrameJob } from '../src/preview/pathFrame.ts';
import { bytesHash } from '../src/preview/gcodeList.ts';
import { useLivePlacement } from '../src/preview/useLivePlacement.ts';

const SCENE_COLORS = { bed: [0.7, 0.6, 0.5, 1], fixture: [0.5, 0.6, 0.7, 1], clamp: [0.4, 0.4, 0.4, 1], stock: [0.8, 0.8, 0.8, 1] } as const;

const clock = (): JobClock => {
  let t = Date.parse('2026-11-03T09:00:00Z');
  let n = 0;
  return { now: () => new Date((t += 1000)), newId: () => `j${++n}` };
};

const machine: MachineProfile = { id: 'm1', name: 'Shop X-Carve', templateId: 'xcarve', drive: 'belt', travel: { x: 750, y: 750, z: 65 }, spindle: 'Trim router', createdAt: '2026-11-01T00:00:00Z', revision: 1 };

/**
 * The bed's front-left top corner at machine (-10, -20, -65); a 300 × 200 fixture 12 mm tall at its corner; a
 * 180 × 120 × 6.35 stock on it, zero at its front-left top: planned zero (20, 0, -46.65), stock X 20..200 Y 0..120.
 */
function scene(): JobScene {
  let job: Job = withMachine(newDraftJob(clock()), machine);
  job = withSetup(job, { bed: { ...job.setup.bed, toMachine: { x: -10, y: -20, z: -65 }, source: { kind: 'measured', note: 't', at: 'now' } } });
  job = withSetup(job, { stock: { ...job.setup.stock, width: 180, depth: 120, thickness: 6.35, position: { x: 120, y: 80 } }, fixture: { ...sampleFixture(), height: 12, position: { x: 150, y: 100 } } });
  return jobScene(job, SCENE_COLORS, null);
}

const solid = (s: JobScene, tag: string): SceneSolid | undefined => s.layers.solids.find((x) => x.tag === tag);

/** A report with work position = machine − zero, homed or not. */
function report(mpo: readonly [number, number, number], zero: readonly [number, number, number], extra: Partial<LiveReport> = {}): LiveReport {
  return { mpo: { x: mpo[0], y: mpo[1], z: mpo[2] }, pos: { x: mpo[0] - zero[0], y: mpo[1] - zero[1], z: mpo[2] - zero[2] }, unit: 1, ...extra };
}

describe('the live placement of a job', () => {
  it('the planned scene is as described', () => {
    const s = scene();
    expect(s.zero).toEqual([20, 0, -46.65]);
    expect(solid(s, 'stock')).toMatchObject({ kind: 'box', min: [20, 0, -53], max: [200, 120, -46.65] });
  });

  it('freshly powered and unhomed at 0, 0, 0: the job stays as planned, the tool at the planned zero, and a note says why', () => {
    const planned = scene();
    const p = placeLive(planned, { mpo: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, unit: 1, home: 0, overlays: [] });
    expect(p.established).toBe(false);
    expect(p.scene.layers).toBe(planned.layers);
    expect(p.scene.pathOffset).toEqual(planned.pathOffset);
    expect(p.scene.zero).toEqual(planned.zero);
    expect(p.tool).toEqual([20, 0, -46.65]);
    expect(p.scene.notes).toEqual([UNSET_NOTE]);
    // Jogged 10 mm in X and up 5 mm: the tool follows its work position from the planned zero.
    expect(liveTool(planned, { mpo: { x: 10, y: 0, z: 5 }, pos: { x: 10, y: 0, z: 5 }, unit: 1 })).toEqual([30, 0, -41.65]);
    // Without `home` read at all: not established either.
    expect(positionEstablished({ mpo: {}, pos: {} })).toBe(false);
  });

  it('homed but the session no longer trusts the position (UNKNOWN): not established, with its own note', () => {
    const p = placeLive(scene(), report([20, 0, -46.65], [20, 0, -46.65], { home: 1, overlays: ['UNKNOWN'] }));
    expect(p.established).toBe(false);
    expect(p.scene.notes).toEqual([UNTRUSTED_NOTE]);
  });

  it('homed, with the zeros matching: the planned scene, no notes, the tool at the machine position', () => {
    const planned = scene();
    const p = placeLive(planned, report([25, 3, -40], [20, 0, -46.65], { home: 1, overlays: [] }));
    expect(p.established).toBe(true);
    expect(p.scene.layers).toBe(planned.layers);
    expect(p.scene.notes).toEqual([]);
    expect(p.tool).toEqual([25, 3, -40]);
  });

  it('homed, with an XY offset: stock and clamps move in X and Y at their planned heights; the bed and fixture stay', () => {
    const planned = scene();
    const p = placeLive(planned, report([0, 0, 0], [30, 20, -46.65], { home: 1 }));
    expect(p.scene.pathOffset).toEqual([30, 20, -46.65]);
    expect(p.scene.zero).toEqual([30, 20, -46.65]);
    expect(solid(p.scene, 'stock')).toMatchObject({ min: [30, 20, -53], max: [210, 140, -46.65] });
    expect(solid(p.scene, 'bed')).toBe(solid(planned, 'bed'));
    expect(solid(p.scene, 'fixture')).toBe(solid(planned, 'fixture'));
    const c0 = planned.layers.solids.filter((s) => s.tag === 'clamp')[0];
    const c1 = p.scene.layers.solids.filter((s) => s.tag === 'clamp')[0];
    expect(c0?.kind === 'box' && c1?.kind === 'box' ? [c1.min[0] - c0.min[0], c1.min[1] - c0.min[1], c1.min[2] - c0.min[2]] : null).toEqual([10, 20, 0]);
    expect(p.scene.layers.rings).toBe(planned.layers.rings);
    expect(p.scene.notes).toEqual([]);
  });

  it('homed, with a Z mismatch: the path moves down, the stock does not sink, and the note gives the difference', () => {
    const planned = scene();
    const p = placeLive(planned, report([0, 0, 0], [20, 0, -49.85], { home: 1 }));
    expect(p.scene.pathOffset).toEqual([20, 0, -49.85]);
    expect(solid(p.scene, 'stock')).toBe(solid(planned, 'stock'));
    expect(p.scene.notes).toEqual(['Work zero Z is 3.2 mm below the planned zero (the stock top). The toolpath is drawn where it will cut.']);
    expect(placeLive(planned, report([0, 0, 0], [20, 0, -44.65], { home: 1 })).scene.notes?.[0]).toMatch(/^Work zero Z is 2\.0 mm above/);
    // Half a millimetre or less: no note.
    expect(placeLive(planned, report([0, 0, 0], [20, 0, -47.1], { home: 1 })).scene.notes).toEqual([]);
  });

  it('homed, in inches: the work position is converted before the zero is taken', () => {
    const planned = scene();
    // Machine X 45.4 mm with work X 1 in: the work zero is X 20 mm, the plan's.
    const live: LiveReport = { mpo: { x: 45.4, y: 25.4, z: -46.65 + 25.4 }, pos: { x: 1, y: 1, z: 1 }, unit: 0, home: 1 };
    const p = placeLive(planned, live);
    expect(p.scene.zero.map((v) => Math.round(v * 1000) / 1000)).toEqual([20, 0, -46.65]);
    expect(p.scene.notes).toEqual([]);
    // Unhomed in inches: the tool from the planned zero by the converted work position.
    expect(liveTool(planned, { ...live, home: 0 })?.map((v) => Math.round(v * 1000) / 1000)).toEqual([45.4, 25.4, -21.25]);
  });

  it('the stock moved off the bed or over the fixture’s edge is said, not hidden', () => {
    const planned = scene();
    const edge = placeLive(planned, report([0, 0, 0], [170, 0, -46.65], { home: 1 }));
    expect(edge.scene.notes).toEqual(['At this work zero the stock overhangs the fixture’s edge.']);
    const off = placeLive(planned, report([0, 0, 0], [700, 0, -46.65], { home: 1 }));
    expect(off.scene.notes).toEqual(['At this work zero the stock runs off the bed.', 'At this work zero the stock is off the fixture.']);
  });

  it('placeJobAt keeps an outlined stock (a prism) at its heights', () => {
    const s = scene();
    const prism: JobScene = { ...s, layers: { solids: [{ kind: 'prism', outline: [[0, 0], [10, 0], [10, 10]], z0: 0, z1: 5, color: SCENE_COLORS.stock, tag: 'stock' }], rings: [] } };
    expect(placeJobAt(prism, [s.zero[0] + 1, s.zero[1] + 2, s.zero[2] + 3]).layers.solids[0]).toMatchObject({ outline: [[1, 2], [11, 2], [11, 12]], z0: 0, z1: 5 });
    expect(placeJobAt(s, s.zero)).toBe(s);
  });
});

// ---------------------------------------------------------------- the G92 frame (gcode frames.ts, pathFrame.ts)

const bytesOf = (t: string): Uint8Array => Uint8Array.from(t, (c) => c.charCodeAt(0));
// The head of braid_500mm.gcode as the owner ran it on bench 2: work zero set at machine 0, then the file's own G92.
const BRAID = bytesOf(['N1 T1M6', 'N2 G17', 'N3 G21', 'N4 G92X0.327Y-33.521Z-1.000', 'N5 G0Z4.000', 'N6 F500.0', 'N7 G1X0.327Y-33.521', 'N8 G1Z-1.000', 'N9 X-3.198Y-50.068', 'N10 G0Z4.000', 'N11 M30', ''].join('\n'));
const r3 = (v: readonly number[] | null | undefined): number[] | null => (v === null || v === undefined ? null : v.map((x) => Math.round(x * 1000) / 1000 + 0));

/** The drawn end point of file line `line`, in the path's frame. */
function drawnEnd(result: ReturnType<typeof analyseBytes>['result'], line: number): number[] {
  const seg = result.segments;
  if (seg === null) throw new Error('no segments');
  const i = Array.from(result.sourceLines).lastIndexOf(line);
  const v = (seg.lineToVertex[i + 1] as number) - 1;
  return r3([seg.vertices[v * 3] as number, seg.vertices[v * 3 + 1] as number, seg.vertices[v * 3 + 2] as number]) as number[];
}

const job = (over: Partial<FrameJob> = {}): FrameJob => ({ hash: bytesHash(BRAID), startedAt: 100, executing: null, ackedThrough: null, ...over });

describe('the live placement with a file that sets its own G92', () => {
  const result = analyseBytes(BRAID, { dialect: 'tinyg-en', mode: 'full' }).result;
  // While line 9 runs the board reports work X -3.198 Y -50.068 Z -1 (G92 included) at machine X -3.525 Y -16.547 Z 0.
  const running: LiveReport = { mpo: { x: -3.525, y: -16.547, z: 0 }, pos: { x: -3.198, y: -50.068, z: -1 }, unit: 1 };
  const at9 = livePathFrame(result.frameTable, frameLine(job({ executing: { line: 9 } }), bytesHash(BRAID)));

  it('established: the path is anchored where the board is, and the tool is on the segment it is cutting', () => {
    const planned = scene();
    const p = placeLive(planned, { ...running, home: 1 }, at9);
    expect(p.established).toBe(true);
    expect(p.tool).toEqual([-3.525, -16.547, 0]);
    // The tool in the path's frame (machine minus the path's origin) is the end of line 9 as drawn.
    const o = p.scene.pathOffset;
    expect(r3([(p.tool?.[0] ?? 0) - o[0], (p.tool?.[1] ?? 0) - o[1], (p.tool?.[2] ?? 0) - o[2]])).toEqual(drawnEnd(result, 9));
    // The path's origin is the work zero the owner set (machine 0), not the G92-shifted origin.
    expect(r3(o)).toEqual([0, 0, 0]);
    // Before the fix the work position was taken as the path position: 33.5 mm off in Y.
    expect(r3(placeLive(planned, { ...running, home: 1 }).scene.pathOffset)).toEqual([-0.327, 33.521, 1]);
  });

  it('not established: the path stays planned, the tool at the planned zero plus its place on the path', () => {
    const planned = scene();
    const p = placeLive(planned, { ...running, home: 0 }, at9);
    expect(p.scene.pathOffset).toEqual(planned.pathOffset);
    const z = planned.zero;
    expect(r3(p.tool)).toEqual(r3(drawnEnd(result, 9).map((v, k) => v + (z[k] as number))));
    expect(r3(liveTool(planned, { ...running, home: 0 }, at9.toPath))).toEqual(r3(p.tool));
    expect(p.scene.notes).toEqual([UNSET_NOTE]);
  });

  it('before the job: the offset before the first line, and a note that line 4 re-anchors the cut', () => {
    const planned = scene();
    const idle = livePathFrame(result.frameTable, frameLine(null, bytesHash(BRAID)));
    expect(idle).toEqual({ toPath: [0, 0, 0], nextG92: 4 });
    const p = placeLive(planned, { mpo: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, unit: 1, home: 1 }, idle);
    expect(p.scene.pathOffset).toEqual([0, 0, 0]);
    expect(p.scene.notes).toContain(g92Note(4));
    expect(g92Note(4)).toBe('Line 4 sets a temporary offset (G92): what follows it is cut from wherever the tool is when that line runs, so the drawing may move then.');
    expect(placeLive(planned, { ...running, home: 1 }, at9).scene.notes).not.toContain(g92Note(4));
  });

  it('after M30 the board has dropped the G92 and reports the M30 line: the offset is gone again', () => {
    const end = livePathFrame(result.frameTable, frameLine(job({ executing: { line: 11 }, ackedThrough: 11 }), bytesHash(BRAID)));
    expect(end).toEqual({ toPath: [0, 0, 0], nextG92: null });
    const p = placeLive(scene(), { mpo: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, unit: 1, home: 1 }, end);
    expect(p.scene.pathOffset).toEqual([0, 0, 0]);
  });

  it('inches: the work position is converted before the offset is added', () => {
    const inch = analyseBytes(bytesOf('G20 G90\nG0 X1 Y1\nG92 X0 Y0\nG0 X0.5 Y0.25\nM30\n'), { dialect: 'tinyg-en', mode: 'full' }).result;
    const f = livePathFrame(inch.frameTable, 4);
    // Machine X 38.1 Y 31.75 (25.4 + 12.7, 25.4 + 6.35), work X 0.5 Y 0.25 in.
    const p = placeLive(scene(), { mpo: { x: 38.1, y: 31.75, z: 0 }, pos: { x: 0.5, y: 0.25, z: 0 }, unit: 0, home: 1 }, f);
    const o = p.scene.pathOffset;
    expect(r3([38.1 - o[0], 31.75 - o[1], 0 - o[2]])).toEqual(drawnEnd(inch, 4));
  });

  it('the hook: without a planned scene the tool is given in the path’s own frame; without a full report, no tool', () => {
    const run = (...args: Parameters<typeof useLivePlacement>): ReturnType<typeof useLivePlacement> => {
      let out: ReturnType<typeof useLivePlacement> | null = null;
      renderToString(h(() => { out = useLivePlacement(...args); return null; }, null));
      if (out === null) throw new Error('not rendered');
      return out;
    };
    expect(r3(run(null, { ...running, home: 1 }, at9).tool)).toEqual(drawnEnd(result, 9));
    expect(run(null, { mpo: { x: 1, y: 2 }, pos: { x: 1, y: 2, z: 3 }, unit: 1 }, at9).tool).toBeNull();
    expect(run(null, null, at9)).toEqual({ scene: null, tool: null });
    const planned = scene();
    expect(run(planned, { ...running, home: 1 }, at9).tool).toEqual([-3.525, -16.547, 0]);
  });

  it('without a frame (no file) the placement is the planned one it always was', () => {
    expect(livePathFrame(null, 9)).toBe(PLANNED_FRAME);
    const planned = scene();
    expect(placeLive(planned, report([25, 3, -40], [20, 0, -46.65], { home: 1 }), PLANNED_FRAME).scene.layers).toBe(planned.layers);
  });
});

describe('which line the board’s work position belongs to', () => {
  const hash = bytesHash(BRAID);

  it('no job, another file’s job, or a job not started yet: before the first line', () => {
    expect(frameLine(null, hash)).toBe(0);
    expect(frameLine(job({ executing: { line: 9 } }), null)).toBe(0);
    expect(frameLine(job({ hash: 'deadbeef', executing: { line: 9 } }), hash)).toBe(0);
    expect(frameLine(job({ startedAt: null, executing: { line: 9 }, ackedThrough: 9 }), hash)).toBe(0);
  });

  it('running, ended or stopped: the line the board reports; outside the job (a jog since), the last answered line', () => {
    expect(frameLine(job({ executing: { line: 9 }, ackedThrough: 10 }), hash)).toBe(9);
    expect(frameLine(job({ executing: { line: 11 }, ackedThrough: 11 }), hash)).toBe(11);
    expect(frameLine(job({ executing: null, ackedThrough: 8 }), hash)).toBe(8);
    expect(frameLine(job({ executing: null, ackedThrough: null }), hash)).toBe(0);
  });
});

