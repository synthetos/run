/**
 * T-S117 (as redesigned, owner 2026-11-09): the Run step's "Ready to start?" list. Start is enabled only when no item
 * is blocked or still checking and the one tick is given; the tick lists exactly the confirmations that apply (C31,
 * C36, C32 and the attestation); the travel question (C40, or C41 which also answers C36) is asked at Start; every
 * blocker says its real reason and the action that clears it.
 */
import { describe, expect, it } from 'vitest';
import { readyModel, type ReadyInput } from '../src/workspace/run/readyModel.ts';
import { tickText, travelPastText, travelUncheckedText } from '../src/workspace/run/runCopy.ts';

const READY: ReadyInput = {
  connected: true,
  jobsOn: true,
  block: null,
  wait: null,
  fileName: 'part.nc',
  check: { state: 'done', lines: 29710, toolChanges: 5, seconds: 21600 },
  zero: { state: 'match', comparable: true },
  homed: true,
  homedBy: 'homing',
  canHome: true,
  travel: { kind: 'fits' },
  modes: 'Absolute, mm',
  feeds: 'Feeds: within range',
  spindle: { starts: false, speeds: '' },
};

const PAST = { kind: 'past', axis: 'Y', line: 34, reach: -1.6, limit: 0, unit: 'mm', more: 0, text: 'line 34: Y would reach machine -1.6 mm', homeable: true } as const;

const marks = (input: ReadyInput): Record<string, string> => Object.fromEntries(readyModel(input).items.map((i) => [i.id, i.mark]));

describe('readyModel', () => {
  it('a healthy, homed board with the file checked: nothing blocks, one tick (stay at the machine), Start asks nothing first', () => {
    const m = readyModel(READY);
    expect(m.blocked).toBe(false);
    expect(m.tick).toEqual(['attended']);
    expect(m.travelAsk).toBeNull();
    expect(marks(READY)).toEqual({ file: 'done', zero: 'done', position: 'done', travel: 'done', modes: 'done', feeds: 'done', tool: 'done' });
    expect(m.items.find((i) => i.id === 'file')?.summary).toBe('Checked. 29,710 lines, about 6 h 00 min.');
    expect(tickText(m.tick)).toBe("I confirm: I'll stay here, sleep off.");
  });

  it('not homed: Position needs you with Home, and the one tick adds C36', () => {
    const m = readyModel({ ...READY, homed: false });
    expect(m.items.find((i) => i.id === 'position')).toMatchObject({ mark: 'needs', summary: 'Not homed.', actions: [{ id: 'home', label: 'Home' }] });
    expect(m.tick).toEqual(['unhomed', 'attended']);
    expect(readyModel({ ...READY, homed: false, canHome: false }).items.find((i) => i.id === 'position')?.actions).toEqual([]);
  });

  it('a move past the travel of an axis that is not homed: asked at Start (C41), which also answers C36, so the tick leaves it out', () => {
    const m = readyModel({ ...READY, homed: false, travel: PAST });
    expect(m.travelAsk).toEqual(PAST);
    expect(m.tick).toEqual(['attended']);
    expect(m.items.find((i) => i.id === 'travel')).toMatchObject({ mark: 'needs', summary: 'Line 34 goes past Y.', actions: [{ id: 'home', label: 'Home Y' }] });
    expect(travelPastText(PAST)).toEqual({ title: 'This job goes past the Y limit.', body: "Line 34 moves Y to -1.6 mm. Y stops at 0 mm. Y isn't homed, so its position may be off." });
    // `more` counts moves (split long ones), not lines: no number, only that others go past too.
    expect(travelPastText({ ...PAST, more: 59119 }).body).toMatch(/ Other lines go past too\.$/);
  });

  it('a travel that could not be checked: asked at Start (C40); not homed keeps C36 in the tick', () => {
    const unchecked = { kind: 'unchecked', why: 'the travel limits of X were not read', text: 'the travel limits of X were not read' } as const;
    const m = readyModel({ ...READY, homed: false, travel: unchecked });
    expect(m.travelAsk).toEqual(unchecked);
    expect(m.tick).toEqual(['unhomed', 'attended']);
    expect(travelUncheckedText(unchecked.why)).toEqual({ title: "Run can't check this job against the travel.", body: 'The travel limits of X were not read. Start only if every move fits.' });
  });

  it('work zero not the plan’s adds C31; not read yet blocks; the spindle adds C32', () => {
    expect(readyModel({ ...READY, zero: { state: 'differs', comparable: true } }).tick).toEqual(['workZero', 'attended']);
    expect(readyModel({ ...READY, zero: { state: 'differs', comparable: false } }).items.find((i) => i.id === 'zero')?.summary).toBe('Can’t compare.');
    expect(readyModel({ ...READY, zero: { state: 'unknown', comparable: false } }).blocked).toBe(true);
    const spindle = readyModel({ ...READY, spindle: { starts: true, speeds: '12,000 rpm' } });
    expect(spindle.tick).toEqual(['spindle', 'attended']);
    expect(spindle.items.find((i) => i.id === 'spindle')?.summary).toBe('12,000 rpm, on by itself.');
    expect(tickText(['workZero', 'unhomed', 'spindle', 'attended'])).toBe("I confirm: the board's work zero · axes checked · hands clear · I'll stay here, sleep off.");
  });

  it('blockers: each is ✕ with its real reason and the action that clears it; nothing to tick until it is gone', () => {
    const notConnected = readyModel({ ...READY, connected: false, zero: null, homed: null, travel: null, spindle: null, check: { state: 'none' } });
    expect(notConnected.items[0]).toMatchObject({ id: 'machine', mark: 'blocked', summary: 'Not connected.', actions: [{ id: 'connect', label: 'Connect' }] });
    expect(notConnected.tick).toEqual([]);
    expect(readyModel({ ...READY, jobsOn: false }).items[0]).toMatchObject({ mark: 'blocked', summary: 'Running jobs isn’t on in this build.' });
    const flow = readyModel({ ...READY, block: { kind: 'not-approved', reason: 'flowControl', title: 'Run can’t control this board yet.', lines: ['It’s set to hardware flow control (RTS/CTS, ex = 2), which Run hasn’t verified.'], actions: [{ id: 'disconnect', label: 'Disconnect' }] } });
    // The title in the list; the full, real reason is the Position panel's card beside it.
    expect(flow.items[0]?.summary).toBe('Run can’t control this board yet.');
    expect(flow.items[0]?.actions).toEqual([{ id: 'disconnect', label: 'Disconnect' }]);
    expect(flow.blocked).toBe(true);
    expect(flow.tick).toEqual([]);
    // Behind the block the file is not checked yet: it says when it will be, never "checking" forever.
    const behind = readyModel({ ...READY, block: flow.items[0] === undefined ? null : { kind: 'not-approved', title: 'x', lines: [], actions: [] }, check: { state: 'checking' }, travel: null });
    expect(behind.items.find((i) => i.id === 'file')).toMatchObject({ mark: 'needs', summary: 'Checked once the board can run jobs.' });
    expect(behind.items.find((i) => i.id === 'travel')?.mark).toBe('needs');
    const unknown = readyModel({ ...READY, block: { kind: 'unknown', title: 'Position not verified.', lines: [], actions: [] } });
    expect(unknown.items[0]).toMatchObject({ summary: 'Position not verified.', actions: [{ id: 'verify', label: 'Check…' }] });
    const alarm = readyModel({ ...READY, block: { kind: 'alarm', title: 'The controller is in alarm, so it stopped.', lines: ['Clear the alarm before moving.'], actions: [{ id: 'clear-alarm', label: 'Clear alarm…' }] } });
    expect(alarm.items[0]?.actions).toEqual([{ id: 'clear-alarm', label: 'Clear alarm…' }]);
  });

  it('still checking is … and holds Start; a blocked file names its first finding', () => {
    expect(readyModel({ ...READY, check: { state: 'checking' } }).items.find((i) => i.id === 'file')).toMatchObject({ mark: 'waiting', summary: 'Checking with this board…' });
    expect(readyModel({ ...READY, wait: 'Setting up the connection…' }).items[0]).toMatchObject({ mark: 'waiting', summary: 'Setting up the connection…' });
    const blocked = readyModel({ ...READY, check: { state: 'blocked', line: 120, message: 'the arc radius does not match', more: 2 } });
    expect(blocked.items.find((i) => i.id === 'file')).toMatchObject({ mark: 'blocked', summary: 'Line 120: the arc radius does not match (+2 more)' });
    expect(blocked.blocked).toBe(true);
  });

  it('feeds is advisory: needs review offers Analyze but never blocks Start', () => {
    const m = readyModel({ ...READY, feeds: 'Feeds: needs review in Analyze' });
    expect(m.items.find((i) => i.id === 'feeds')).toMatchObject({ mark: 'needs', summary: 'Review.', actions: [{ id: 'analyze', label: 'Analyze' }] });
    expect(m.blocked).toBe(false);
  });
});

describe('the travel question when the work zero is not the plan\'s', () => {
  it('leads with Set work zero first; Start anyway is no longer the main button', async () => {
    const { renderToString } = await import('preact-render-to-string');
    const { h } = await import('preact');
    const { TravelModal } = await import('../src/workspace/run/TravelModal.ts');
    const ask = { ...PAST, zeroFirst: true };
    const html = renderToString(h(TravelModal, { ask, onZero: () => undefined, onStart: () => undefined, onCancel: () => undefined }));
    expect(html).toMatch(/class="small primary" data-action="travel-zero"[^>]*>Set work zero first</);
    expect(html).toMatch(/class="small" data-action="travel-start"[^>]*>Start anyway</);
    expect(html).toContain("Your work zero isn't where you planned it.");
    const plain = renderToString(h(TravelModal, { ask: PAST, onStart: () => undefined, onCancel: () => undefined }));
    expect(plain).not.toContain('travel-zero');
    expect(plain).toMatch(/class="small primary" data-action="travel-start"/);
  });
});
