/**
 * A paused job (first-time walk 2026-11-08, S3 and B2):
 * - the strip never calls a held machine "Machine idle": "Paused · spindle still on" (or "Paused"), in the hold tone;
 * - the Run card puts Resume at the top, under the phase, with the spindle's state, and it sends the same
 *   session request as the strip's Resume; there is one Resume in the card.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { STOP_TEXT } from '@synthetos/safety';
import { stripStatus } from '../src/workspace/status.ts';
import { JobStatus } from '../src/workspace/views/JobViews.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { job, liveModel, snap, view } from './jobFixtures.ts';

/** A live view with the DRO the strip reads its units from. */
function withDro(s: ReturnType<typeof snap>): ReturnType<typeof view> {
  const v = view(s);
  return { ...v, message: { ...(v.message as object), dro: { units: 'mm', axes: [] } } as unknown as typeof v.message };
}

const HELD = { stat: 6, hold: 4, vel: 0, qr: 30, home: 1, pos: {}, mpo: {}, machineClass: 'held' };

describe('a held machine in the strip (S3)', () => {
  it('says Paused · spindle still on when the board reports the spindle on, in the hold tone', () => {
    const s = stripStatus(withDro(snap({ base: 'HELD', live: { ...HELD, spe: 1 }, job: job({ phase: 'paused', startedAt: 0 }) })), 'My X-Carve');
    expect(s.title).toBe(STOP_TEXT.pausedSpindleOn);
    expect(s.tone).toBe('hold');
  });
  it('says Paused with the spindle off, never Machine idle', () => {
    const s = stripStatus(withDro(snap({ base: 'HELD', live: { ...HELD, spe: 0 } })), null);
    expect(s.title).toBe(STOP_TEXT.paused);
    expect(s.title).not.toBe('Machine idle');
  });
});

describe('Resume at the top of the paused job card (B2)', () => {
  const paused = snap({ base: 'HELD', live: { ...HELD, spe: 1 }, job: job({ phase: 'paused', startedAt: 0, sent: 1, acked: 1, executing: { n: 1, line: 1 } }) });

  it('shows one Resume, before the progress bar, with the spindle state, and sends the session resume', () => {
    const { model, job: jobFn } = liveModel(paused);
    const tree = root(h(JobStatus, { model, onPause: () => undefined, onStopJob: () => undefined }));
    const grid = one(tree, (e) => e.props['class'] === 'job-status-grid');
    const kids = grid.children.filter((c): c is El => typeof c !== 'string');
    const rowAt = kids.findIndex((c) => c.props['data-job'] === 'resume-row');
    const barAt = kids.findIndex((c) => c.props['role'] === 'progressbar');
    expect(rowAt).toBeGreaterThan(-1);
    expect(rowAt).toBeLessThan(barAt);
    expect(text(kids[rowAt] as El)).toContain(STOP_TEXT.pausedSpindleOn);
    const resumes = all(tree, byAttr('data-machine-control', 'resume'));
    expect(resumes).toHaveLength(1);
    (resumes[0]?.props['onClick'] as () => void)();
    expect(jobFn).toHaveBeenCalledWith({ op: 'resume', skip: false, spindleRestart: false });
  });

  it('has no Resume row while the job runs', () => {
    const { model } = liveModel(snap({ base: 'RUNNING', job: job({ phase: 'running', startedAt: 0, sent: 1, acked: 1, executing: { n: 1, line: 1 } }) }));
    const tree = root(h(JobStatus, { model }));
    expect(all(tree, byAttr('data-job', 'resume-row'))).toHaveLength(0);
    expect(all(tree, byAttr('data-machine-control', 'resume'))).toHaveLength(0);
  });
});
