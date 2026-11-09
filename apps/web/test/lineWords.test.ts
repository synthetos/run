/** Lines as the user counts them (first-time walk 2026-11-08, C5). */
import { describe, expect, it } from 'vitest';
import { addedLinesText, checkedText, fileSummary } from '../src/workspace/lineWords.ts';
import { stripStatus } from '../src/workspace/status.ts';
import { job, snap, view } from './jobFixtures.ts';

describe('line words (C5)', () => {
  it('the G-code tab counts the file', () => {
    expect(fileSummary(28, 26)).toBe('28 lines, 26 with commands');
  });
  it('the check names the file’s lines and what Run adds, not a second total', () => {
    expect(checkedText(34, 26, 0)).toBe('Checked with this board: the file’s 26 lines with commands, plus 8 lines Run adds (it sets the units and modes and ends the job)');
    expect(addedLinesText(30, 26, 2)).toBe('plus 4 lines Run adds (it splits long moves into shorter ones and sets the units and modes)');
    expect(checkedText(26, 26, 0)).toBe('Checked with this board: the file’s 26 lines with commands');
  });
  it('the strip’s Job readout is the file line while a job runs, else no job', () => {
    const withDro = (v: ReturnType<typeof view>) => ({ ...v, message: { ...(v.message as object), dro: { units: 'mm', axes: [] } } as unknown as typeof v.message });
    const running = stripStatus(withDro(view(snap({ base: 'RUNNING', live: { stat: 5, line: 6, pos: {}, mpo: {}, machineClass: 'running' }, job: job({ phase: 'running', startedAt: 0, executing: { n: 6, line: 8 } }) }))), null);
    expect(running.readouts.find((r) => r.label === 'Job')?.value).toBe('file line 8');
    const idle = stripStatus(withDro(view(snap({ job: null }))), null);
    expect(idle.readouts.find((r) => r.label === 'Job')?.value).toBe('No job running');
  });
});
