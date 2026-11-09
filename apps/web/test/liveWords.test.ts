/** The Live job log and confirmations in plain words for Simple (first-time walk 2026-11-08, C11, C12). */
import { describe, expect, it } from 'vitest';
import { emptyQueueText, liveEventText, liveLineLabel } from '../src/workspace/liveWords.ts';

describe('live words (C11)', () => {
  it('Simple rewrites the events that name firmware keys; Advanced keeps the session’s words', () => {
    expect(liveEventText('Streaming in line mode.', false)).toBe('Sending the job one line at a time.');
    expect(liveEventText('Line mode put back: rxm 0 (saved on the board).', false)).toBe('The board’s line setting is back to what it was before the job.');
    expect(liveEventText('Pause: feedhold sent.', false)).toBe('Pause sent.');
    expect(liveEventText('Pause: feedhold sent.', true)).toBe('Pause: feedhold sent.');
    expect(liveEventText('Stopped at line 10: queue cleared, spindle and coolant off', false)).toBe('Stopped at line 10: queue cleared, spindle and coolant off');
  });
  it('line labels and the empty queue', () => {
    expect(liveLineLabel(17, false)).toBe('line 17');
    expect(liveLineLabel(17, true)).toBe('L17');
    expect(liveLineLabel(undefined, false)).toBe('');
    expect(emptyQueueText(false)).toBe('Nothing is queued on the board.');
    expect(emptyQueueText(true)).toBe('The planner queue is empty.');
  });
});
