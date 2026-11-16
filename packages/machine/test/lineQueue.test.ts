import { expect, it } from 'vitest';
import { enqueueLine } from '../src/session/lineQueue.ts';
import { initialState, type SessionEffect } from '../src/index.ts';
import type { QueuedLine } from '../src/session/sessionRuntime.ts';
it('inserts a control override before queued G-code, retaining earlier control order', () => {
  const s = initialState(), lines: QueuedLine[] = [];
  const add = (seq: number, intent?: Extract<SessionEffect, { kind: 'writeLine' }>['intent'], line = 'N1 G1 X1') => enqueueLine(lines, { kind: 'writeLine', epoch: 1, seq, token: 'job', line, ...(intent ? { intent } : {}), index: seq }, s);
  add(1); add(2, 'jobLine'); add(3, 'jobLine'); add(4, 'jobRuntime', '{"rt":{"mfo":1.2}}');
  expect(lines.map(l => l.seq)).toEqual([1, 4, 2, 3]);
  add(5, 'jobRuntime', '{"rt":{"job":1}}');
  expect(lines.at(-1)?.seq).toBe(5);
  for (const intent of ['settingsWrite', 'configureReports', 'lineMode', 'flash'] as const) add(6, intent);
  enqueueLine(lines, { kind: 'writeLine', epoch: 1, seq: 7, token: 'gc', line: 'G0 X0', motion: { intent: 'jog' } }, s);
  expect(lines.at(-1)?.motion).toBe('jog');
  const empty: QueuedLine[] = [];
  enqueueLine(empty, { kind: 'writeLine', epoch: 1, seq: 8, token: 'rt', line: '{"rt":{"sso":0.8}}', intent: 'jobRuntime' }, s);
  expect(empty[0]?.jobRuntime).toBe(true);
});
