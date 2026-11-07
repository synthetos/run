/**
 * Probe Z's cards (SAFETY §4.5c, H90): each step renders what the session reports and sends only its narrow
 * commands; the flow through the mount from Setup to "The plate is off"; and the rules around it (in flow, never a
 * dialog over the stop controls except C13's existing card; Cancel holds the focus; no button in the probe itself).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { h, type ComponentChild } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { ProbeOutcome, ProbePlan, ProbeSnapshot } from '@synthetos/machine';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { probeSnap } from './probeFixture.ts';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveActions, type LiveView, type WorkspaceModel } from '../src/workspace/model.ts';
import { uiLevel } from '../src/workspace/jobWorkflow.ts';
import { focusOnMount } from '../src/workspace/ui.ts';
import type { MotionCommand } from '../src/machine-worker/rpc.ts';
import { InputReading } from '../src/workspace/probe/InputReading.ts';
import { ProbeBlocked } from '../src/workspace/probe/ProbeBlocked.ts';
import { ProbeSetup, type ProbeSetupProps } from '../src/workspace/probe/ProbeSetup.ts';
import { ProbeTouch, touchPassed, type ProbeTouchProps } from '../src/workspace/probe/ProbeTouch.ts';
import { ProbeReady, systemNumber, type ProbeReadyProps } from '../src/workspace/probe/ProbeReady.ts';
import { ProbeRunning } from '../src/workspace/probe/ProbeRunning.ts';
import { ProbeResult, type ProbeResultProps } from '../src/workspace/probe/ProbeResult.ts';
import { ProbeZ, probeZBody, type Hooks } from '../src/workspace/probe/ProbeZ.ts';
import { initialForm, type ProbeForm } from '../src/workspace/probe/probeForm.ts';
import { w51, w52 } from '../src/workspace/probe/probeStrings.ts';

const noop = (): void => undefined;
const button = (el: El, action: string): El => one(el, (e) => e.tag === 'button' && e.props['data-action'] === action, action);
const buttons = (el: El, action: string): El[] => all(el, (e) => e.tag === 'button' && e.props['data-action'] === action);
const click = (el: El): void => (el.props['onClick'] as () => void)();
const enabled = (el: El): boolean => el.props['disabled'] !== true && typeof el.props['onClick'] === 'function';

/** Elements whose ref is `focusOnMount` (Preact keeps refs off the props), by tag and data-action. */
function focused(node: ComponentChild): string[] {
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((c: ComponentChild) => focused(c));
  const v = node as unknown as { type: unknown; props: Record<string, unknown>; ref?: unknown };
  if (typeof v.type === 'function') return focused((v.type as (p: unknown) => ComponentChild)(v.props));
  const own = v.ref === focusOnMount ? [`${String(v.type)}${typeof v.props['data-action'] === 'string' ? `:${v.props['data-action']}` : ''}`] : [];
  return [...own, ...focused(v.props['children'] as ComponentChild)];
}

const PLAN: ProbePlan = { thicknessMm: 12.7, depthMm: 5, feed: 25, stopMm: 0.017, zeroZ: 12.683, maxSeconds: 17 };

afterEach(() => uiLevel.set('simple'));

describe('InputReading', () => {
  it('words, never colour alone; Advanced adds the raw token and polarity', () => {
    const input = { label: 'Z min', token: 'in5', reading: 'touching' as const, activeLow: true };
    expect(text(root(h(InputReading, { input, advanced: false })))).toBe('Probe input (Z min)Touching');
    expect(text(root(h(InputReading, { input, advanced: true })))).toContain('in5 = 1 · prbp 0 (active low) · read only');
    expect(text(root(h(InputReading, { input: { ...input, reading: 'clear', activeLow: false }, advanced: true })))).toContain('Not touching' + 'in5 = 0 · prbp 1 (active high)');
    expect(text(root(h(InputReading, { input: { ...input, reading: 'disabled' }, advanced: true })))).toContain('Input disabled');
    expect(text(root(h(InputReading, { input: { ...input, reading: null }, advanced: false })))).toContain('No reading');
    expect(text(root(h(InputReading, { input: null, advanced: true })))).toBe('Probe inputNo reading');
  });
});

describe('ProbeBlocked', () => {
  it('the reason and the next step, with one plain button', () => {
    let closed = 0;
    const el = root(h(ProbeBlocked, { block: 'noInput', label: 'Close', onClose: () => closed++ }));
    expect(text(el)).toContain('This board has no probe input set.');
    expect(text(el)).toContain('Zero Z by hand');
    click(button(el, 'probe-close'));
    expect(closed).toBe(1);
    expect(all(root(h(ProbeBlocked, { block: 'motionOff', label: 'Cancel', onClose: noop })), byAttr('class', 'probe-next'))).toHaveLength(0);
  });
});

describe('ProbeSetup', () => {
  function setup(extra: Partial<ProbeSetupProps> = {}): { el: El; changes: ProbeForm[]; next: number[] } {
    const changes: ProbeForm[] = [];
    const next: number[] = [];
    const el = root(h(ProbeSetup, { form: initialForm(null), zjh: 40, system: 'G54', remembered: false, advanced: false, onChange: (f) => changes.push(f), onNext: () => next.push(1), onCancel: noop, ...extra }));
    return { el, changes, next };
  }

  it('Test the plate waits for a valid form and the spindle check; the thickness field takes the focus when empty', () => {
    const { el } = setup();
    expect(enabled(button(el, 'probe-touch'))).toBe(false);
    expect(text(el)).toContain('Measure it; Run can’t check this.');
    expect(focused(h(ProbeSetup, { form: initialForm(null), zjh: 40, system: 'G54', remembered: false, advanced: false, onChange: noop, onNext: noop, onCancel: noop }))).toEqual(['input']);
    const filled = setup({ form: { ...initialForm(12.7), spindleStopped: true }, remembered: true });
    expect(text(filled.el)).toContain('Last used. Check it matches this plate.');
    
    click(button(filled.el, 'probe-touch'));
    expect(filled.next).toHaveLength(1);
    expect(text(button(filled.el, 'probe-touch'))).toBe('Test the plate');
    expect(text(button(filled.el, 'probe-cancel'))).toBe('Cancel');
    expect(enabled(button(setup({ form: initialForm(12.7) }).el, 'probe-touch'))).toBe(false);
  });

  it('presets, Custom and the typed values go back through onChange', () => {
    const { el, changes } = setup();
    click(one(el, byAttr('data-probe-preset', 'Depth limit:10')));
    click(one(el, byAttr('data-probe-preset', 'Feed:custom')));
    (one(el, byAttr('id', 'probe-thickness')).props['onInput'] as (e: unknown) => void)({ currentTarget: { value: '3.2' } });
    (one(el, (e) => e.tag === 'input' && e.props['type'] === 'checkbox').props['onChange'] as (e: unknown) => void)({ currentTarget: { checked: true } });
    expect(changes.map((c) => [c.depth, c.depthCustom, c.feed, c.feedCustom, c.thickness, c.spindleStopped])).toEqual([
      ['10', false, '25', false, '', false],
      ['5', false, '25', true, '', false],
      ['5', false, '25', false, '3.2', false],
      ['5', false, '25', false, '', true],
    ]);
    const custom = setup({ form: { ...initialForm(12.7), feedCustom: true, feed: '200' } });
    const field = one(custom.el, byAttr('id', 'probe-feed'));
    (field.props['onInput'] as (e: unknown) => void)({ currentTarget: { value: '40' } });
    expect(custom.changes[0]).toMatchObject({ feed: '40', feedCustom: true });
    expect(text(custom.el)).toContain('Feed can be 10 to 100 mm/min.');
    expect(one(custom.el, byAttr('data-probe-preset', 'Feed:custom')).props['aria-pressed']).toBe('true');
  });

  it('a wrong thickness says so; the stop distance only at Advanced', () => {
    expect(text(setup({ form: { ...initialForm(null), thickness: '99' } }).el)).toContain('Plate thickness can be 0.1 to 50 mm.');
    expect(all(setup().el, byAttr('data-probe', 'stop-distance'))).toHaveLength(0);
    expect(text(one(setup({ advanced: true }).el, byAttr('data-probe', 'stop-distance')))).toBe('Stop distance about 0.022 mm, calculated from zjh 40 at F25.');
    expect(all(setup({ advanced: true, zjh: null }).el, byAttr('data-probe', 'stop-distance'))).toHaveLength(0);
  });
});

describe('ProbeTouch', () => {
  const touch = (t: Partial<ProbeSnapshot['touch']>): ProbeSnapshot['touch'] => ({ sawClear: false, sawTouching: false, sawReleased: false, problem: null, ...t });
  function render(extra: Partial<ProbeTouchProps> = {}): El {
    return root(h(ProbeTouch, { input: probeSnap().input, touch: touch({}), advanced: false, onContinue: noop, onRetest: noop, onCancel: noop, ...extra }));
  }

  it('marks fill in from readings only, Cancel holds the focus', () => {
    const el = render({ touch: touch({ sawClear: true }) });
    expect(all(el, byAttr('data-done', 'true')).map((e) => e.props['data-touch'])).toEqual(['clear']);
    expect(focused(h(ProbeTouch, { input: null, touch: touch({}), advanced: false, onContinue: noop, onRetest: noop, onCancel: noop }))).toEqual(['button:probe-cancel']);
    expect(buttons(el, 'probe-continue')).toHaveLength(0);
  });

  it('passed: says what it proves, and offers Continue', () => {
    let next = 0;
    const el = render({ touch: touch({ sawClear: true, sawTouching: true, sawReleased: true }), onContinue: () => next++ });
    expect(text(el)).toContain('Touch test passed. The lead worked just now.');
    click(button(el, 'probe-continue'));
    expect(next).toBe(1);
    expect(touchPassed(touch({ sawClear: true, sawTouching: true, sawReleased: true, problem: 'timedOut' }))).toBe(false);
  });

  it('each problem has its words and Test again; an unreadable input says so', () => {
    for (const problem of ['startedTouching', 'noChange', 'timedOut'] as const) {
      let retest = 0;
      const el = render({ touch: touch({ problem }), onRetest: () => retest++ });
      expect(one(el, byAttr('data-touch-problem', problem))).toBeDefined();
      click(button(el, 'probe-retest'));
      expect(retest).toBe(1);
    }
    expect(text(render({ input: null }))).toContain('Run can’t read the probe input.');
    const disabled = render({ input: { label: 'Z min', token: 'in5', reading: 'disabled', activeLow: true }, touch: touch({ sawClear: true, sawTouching: true, sawReleased: true }) });
    expect(buttons(disabled, 'probe-continue')).toHaveLength(0);
  });
});

describe('ProbeReady', () => {
  function render(extra: Partial<ProbeReadyProps> = {}): El {
    return root(h(ProbeReady, { plan: PLAN, system: 'G54', input: probeSnap().input, homed: true, advanced: false, plateOn: false, onPlate: noop, onStart: noop, onCancel: noop, ...extra }));
  }

  it('C39 with W51 and W52, Cancel focused, Start waits for the plate checkbox', () => {
    const el = render();
    expect(text(one(el, byAttr('data-probe', 'c39')))).toBe('Probe Z? Z will move down at 25 mm/min until the board reports contact, up to 5 mm. On contact Run sets G54 Z so the tool reads 12.683 mm above the work (plate 12.7 mm, less 0.017 mm calculated stop distance). This is saved on the controller.');
    expect(text(one(el, byAttr('data-safety', 'W51')))).toBe(w51());
    expect(text(one(el, byAttr('data-safety', 'W52')))).toBe(w52());
    expect(text(el)).toContain('about 12 s');
    expect(focused(h(ProbeReady, { plan: PLAN, system: 'G54', input: null, homed: true, advanced: false, plateOn: true, onPlate: noop, onStart: noop, onCancel: noop }))).toEqual(['button:probe-cancel']);
    expect(enabled(button(el, 'probe-start'))).toBe(false);
    let started = 0;
    let plate: boolean | null = null;
    const ready = render({ plateOn: true, onStart: () => started++, onPlate: (on) => (plate = on) });
    click(button(ready, 'probe-start'));
    (one(ready, (e) => e.tag === 'input').props['onChange'] as (e: unknown) => void)({ currentTarget: { checked: false } });
    expect([started, plate]).toEqual([1, false]);
    expect(text(button(ready, 'probe-start'))).toBe('Start probe');
  });

  it('refuses to start while the input reads touching or without a plan; notes unhomed; Advanced shows the lines', () => {
    const touching = render({ plateOn: true, input: { label: 'Z min', token: 'in5', reading: 'touching', activeLow: true } });
    expect(enabled(button(touching, 'probe-start'))).toBe(false);
    expect(text(touching)).toContain('The input reads touching.');
    const waiting = render({ plan: null, plateOn: true });
    expect(enabled(button(waiting, 'probe-start'))).toBe(false);
    expect(text(waiting)).toContain('Waiting for the board.');
    expect(all(render(), byAttr('data-probe', 'unhomed'))).toHaveLength(0);
    expect(text(render({ homed: false }))).toContain('isn’t homed, so soft limits won’t check this move');
    expect(text(one(render({ advanced: true, system: 'G55' }), byAttr('data-probe', 'gcode')))).toBe('G21, G91 G38.2 Z-5 F25, then G10 L20 P2 Z12.683 (12.7 less 0.017)');
    expect([systemNumber('G54'), systemNumber('G59'), systemNumber('G53'), systemNumber('')]).toEqual([1, 6, 1, 1]);
  });
});

describe('ProbeRunning', () => {
  it('no buttons at all; W51 says what to use; no contact claimed before the report', () => {
    for (const step of ['starting', 'probing', 'zeroing'] as const) {
      const el = root(h(ProbeRunning, { step, plan: PLAN, input: probeSnap().input, advanced: false }));
      expect(all(el, (e) => e.tag === 'button')).toHaveLength(0);
      expect(text(one(el, byAttr('data-safety', 'W51')))).toBe(w51());
      expect(focused(h(ProbeRunning, { step, plan: PLAN, input: null, advanced: false }))).toEqual(['h3']);
    }
    expect(text(root(h(ProbeRunning, { step: 'probing', plan: PLAN, input: null, advanced: false })))).toContain('up to 5 mm (about 12 s)');
    expect(text(root(h(ProbeRunning, { step: 'starting', plan: null, input: null, advanced: false })))).toContain('Starting…Moving down until the board reports contact.');
    expect(text(root(h(ProbeRunning, { step: 'zeroing', plan: PLAN, input: null, advanced: false })))).toContain('The board reported contact. Setting Z…');
  });
});

describe('ProbeResult', () => {
  function render(outcome: ProbeOutcome, extra: Partial<ProbeResultProps> = {}): El {
    return root(h(ProbeResult, { outcome, system: 'G54', alarm: false, liftBlocked: null, advanced: false, onLift: noop, onClear: noop, onPlateOff: noop, ...extra }));
  }
  const contact: ProbeOutcome = { kind: 'contactZeroSet', zeroZ: 12.683, travelMm: 6.3, stopMm: 0.017 };

  it('contact: the zero the board reports, Lift Z and The plate is off', () => {
    const el = render(contact);
    expect(text(one(el, (e) => e.tag === 'h3'))).toBe('Contact. Z zero is set.');
    expect(one(el, byAttr('data-probe-outcome', 'contactZeroSet')).props['role']).toBe('status');
    expect(text(button(el, 'probe-lift'))).toBe('Lift Z 5 mm');
    expect(text(button(el, 'probe-plate-off'))).toBe('The plate is off');
    expect(text(el)).toContain('Until then Run won’t start a job or the spindle.');
    expect(all(el, byAttr('data-probe', 'stop-distance'))).toHaveLength(0);
    expect(text(render(contact, { advanced: true }))).toContain('Stop distance about 0.017 mm, calculated, taken off the zero.');
    const blocked = button(render(contact, { liftBlocked: 'A move is running.' }), 'probe-lift');
    expect([enabled(blocked), blocked.props['title']]).toEqual([false, 'A move is running.']);
  });

  it('failures are alerts; an alarm offers Clear alarm, never Lift; a limit offers neither', () => {
    let clears = 0;
    const alarmed = render({ kind: 'noContact', travelMm: 5, status: 250 }, { alarm: true, advanced: true, onClear: () => clears++ });
    expect(one(alarmed, byAttr('data-probe-outcome', 'noContact')).props['role']).toBe('alert');
    expect(buttons(alarmed, 'probe-lift')).toHaveLength(0);
    click(button(alarmed, 'probe-clear-alarm'));
    expect(clears).toBe(1);
    expect(text(alarmed)).toContain('Board status 250');
    expect(buttons(render({ kind: 'noContact', travelMm: 5, status: 250 }), 'probe-lift')).toHaveLength(1);
    expect(buttons(render({ kind: 'limit', status: 203 }), 'probe-lift')).toHaveLength(0);
    expect(buttons(render({ kind: 'lost', during: 'probe' }), 'probe-lift')).toHaveLength(0);
    const cancelled = render({ kind: 'cancelled' });
    expect(all(cancelled, byAttr('data-probe', 'plate'))).toHaveLength(0);
    expect(text(cancelled)).toContain('Nothing moved.');
  });
});

// ---------------------------------------------------------------- the mount

type Snapshot = NonNullable<LiveView['message']>['snapshot'];

function snapshot(probeZ: ProbeSnapshot | null, extra: Record<string, unknown> = {}): Snapshot {
  return {
    base: 'IDLE_UNHOMED',
    overlays: [],
    primaryOverlay: null,
    epoch: 1,
    port: null,
    probe: null,
    ...(probeZ === null ? {} : { probeZ }),
    identity: { fb: 450.02, fv: 0.97, hp: 1, hv: 8, id: 'SIM-PROBE-1' },
    classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved', detail: '', upgradeOffer: false },
    footerRev: 3,
    live: { machineClass: 'idle', stat: 1, hold: 0, vel: 0, home: 0, pos: {}, mpo: {} },
    values: {},
    fault: null,
    notices: { adviseEstop: false },
    motion: null,
    ...extra,
  } as unknown as Snapshot;
}

function liveView(s: Snapshot): LiveView {
  return { ...INITIAL_LIVE_VIEW, message: { v: 3, kind: 'snapshot', snapshot: s, dro: { axes: [], units: 'mm', wcs: { code: 'G54', offsets: null, total: null } }, motion: true } as unknown as LiveView['message'] };
}

/** A recording pair of state hooks: values kept across renders by call order, as Preact does. */
function harness(model: WorkspaceModel): { render: () => El } {
  const values: unknown[] = [];
  let i = 0;
  const hk: Hooks = {
    state<T>(initial: T): [T, (v: T) => void] {
      const k = i++;
      if (!(k in values)) values[k] = initial;
      return [values[k] as T, (v: T) => void (values[k] = v)];
    },
  };
  return {
    render: () => {
      i = 0;
      return root(probeZBody({ model }, hk));
    },
  };
}

function liveModel(probe: ProbeSnapshot | null, extra: Record<string, unknown> = {}): { model: WorkspaceModel; sent: MotionCommand[]; set: (p: ProbeSnapshot, extra?: Record<string, unknown>) => void } {
  const model = createWorkspaceModel();
  const sent: MotionCommand[] = [];
  model.live.value = liveView(snapshot(probe, extra));
  model.actions.value = { motion: (c: MotionCommand) => (sent.push(c), Promise.resolve(null)) } as unknown as LiveActions;
  return { model, sent, set: (p, e = {}) => void (model.live.value = liveView(snapshot(p, e))) };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ProbeZ: the mount under Position', () => {
  it('prerendered and without a machine: the button, its reason as the tip, nothing else', () => {
    const html = renderToString(h(ProbeZ, { model: null }));
    expect(html).toContain('data-action="probe-open"');
    expect(html).toContain('title="No machine is connected."');
    expect(renderToString(h(ProbeZ, { model: liveModel(probeSnap()).model }))).toContain('title="Set Z zero from a touch plate"');
  });

  it('blocked: opening shows the reason and the next step in place of Setup', () => {
    const { model } = liveModel(probeSnap({ block: 'spindleOn' }));
    const t = harness(model);
    click(button(t.render(), 'probe-open'));
    const el = t.render();
    expect(text(el)).toContain('The spindle is on.Turn it off, then open Probe Z again.');
    click(button(el, 'probe-close'));
    expect(buttons(t.render(), 'probe-open')).toHaveLength(1);
  });

  it('the whole flow: Setup, touch test, Ready, probing, result, plate off', async () => {
    const { model, sent, set } = liveModel(probeSnap());
    const t = harness(model);
    click(button(t.render(), 'probe-open'));
    let el = t.render();
    expect(el.children.some((c) => typeof c !== 'string' && c.props['data-probe-step'] === 'setup')).toBe(true);
    (one(el, byAttr('id', 'probe-thickness')).props['onInput'] as (e: unknown) => void)({ currentTarget: { value: '12.7' } });
    el = t.render();
    (one(el, (e) => e.props['data-action'] === 'probe-spindle').props['onChange'] as (e: unknown) => void)({ currentTarget: { checked: true } });
    click(button(t.render(), 'probe-touch'));
    expect(sent.at(-1)).toEqual({ op: 'probeTouch', thicknessMm: 12.7, depthMm: 5, feed: 25 });

    set(probeSnap({ step: 'touch', plateOut: true, touch: { sawClear: true, sawTouching: true, sawReleased: true, problem: null }, plan: PLAN }));
    click(button(t.render(), 'probe-continue'));
    el = t.render();
    expect(one(el, byAttr('data-probe-step', 'ready'))).toBeDefined();
    (one(el, (e) => e.props['data-action'] === 'probe-plate').props['onChange'] as (e: unknown) => void)({ currentTarget: { checked: true } });
    click(button(t.render(), 'probe-start'));
    expect(sent.at(-1)).toEqual({ op: 'probeStart', confirm: true });

    set(probeSnap({ step: 'probing', plateOut: true, plan: PLAN }), { base: 'PROBING' });
    el = t.render();
    expect(all(el, (e) => e.tag === 'button')).toHaveLength(0);

    set(probeSnap({ step: 'result', plateOut: true, plan: PLAN, outcome: { kind: 'contactZeroSet', zeroZ: 12.683, travelMm: 6.3, stopMm: 0.017 } }));
    click(button(t.render(), 'probe-lift'));
    expect(sent.at(-1)).toEqual({ op: 'jog', axes: { z: 1 }, distanceMm: 5, feed: 1000 });
    click(button(t.render(), 'probe-plate-off'));
    expect(sent.at(-1)).toEqual({ op: 'probePlateOff' });
    set(probeSnap());
    el = t.render();
    expect(text(one(el, byAttr('data-probe', 'done')))).toBe('G54 Z zero set from the touch plate.');
    await settle();
  });

  it('a session refusal shows as a note; Retest and Cancel send their commands', async () => {
    const { model, sent, set } = liveModel(probeSnap({ step: 'touch', plateOut: true, touch: { sawClear: false, sawTouching: false, sawReleased: false, problem: 'noChange' } }));
    model.actions.value = { motion: (c: MotionCommand) => (sent.push(c), Promise.resolve('Probing is not available in this build yet.')) } as unknown as LiveActions;
    const t = harness(model);
    click(button(t.render(), 'probe-retest'));
    click(button(t.render(), 'probe-cancel'));
    expect(sent).toEqual([{ op: 'probeRetest' }, { op: 'probeCancel' }]);
    await settle();
    expect(text(one(t.render(), byAttr('data-probe', 'note')))).toBe('Probing is not available in this build yet.');
    // A block that arrives during the touch test replaces the card; its button cancels.
    set(probeSnap({ step: 'ready', block: 'moving', plateOut: true }));
    click(button(t.render(), 'probe-close'));
    expect(sent.at(-1)).toEqual({ op: 'probeCancel' });
  });

  it('an alarm result: Clear alarm opens C13 (Cancel focused) and sends clearAlarm only on confirm', () => {
    const { model, sent } = liveModel(probeSnap({ step: 'result', plateOut: true, outcome: { kind: 'noContact', travelMm: 5, status: 250 } }), { base: 'ALARM', live: { stat: 2, home: 0, pos: {}, mpo: {} } });
    const t = harness(model);
    click(button(t.render(), 'probe-clear-alarm'));
    let el = t.render();
    const dialog = one(el, byAttr('data-safety', 'C13'));
    expect(text(dialog)).toContain('The probe ended without contact (alarm 250)');
    click(button(el, 'motion-cancel'));
    expect(all(t.render(), byAttr('data-safety', 'C13'))).toHaveLength(0);
    click(button(t.render(), 'probe-clear-alarm'));
    el = t.render();
    click(button(el, 'motion-confirm'));
    expect(sent).toEqual([{ op: 'clearAlarm' }]);
  });

  it('plate still out after the card closed: a reminder with The plate is off; a result waiting for its outcome', () => {
    const { model, sent } = liveModel(probeSnap({ plateOut: true }));
    const t = harness(model);
    const el = t.render();
    expect(text(el)).toContain('Touch plate still out');
    click(button(el, 'probe-plate-off'));
    expect(sent).toEqual([{ op: 'probePlateOff' }]);
    expect(text(harness(liveModel(probeSnap({ step: 'result', plateOut: true })).model).render())).toContain('Waiting for the board.');
  });

  it('never a dialog in the steps, and the Advanced extras follow the level switch', () => {
    uiLevel.set('advanced');
    const steps: ProbeSnapshot[] = [
      probeSnap({ step: 'touch' }),
      probeSnap({ step: 'ready', plan: PLAN }),
      probeSnap({ step: 'starting', plan: PLAN }),
      probeSnap({ step: 'zeroing', plan: PLAN }),
      probeSnap({ step: 'result', outcome: { kind: 'softLimit', status: 220 } }),
    ];
    for (const p of steps) {
      const el = harness(liveModel(p).model).render();
      expect(all(el, (e) => typeof e.props['class'] === 'string' && /dialog|modal/.test(e.props['class']))).toHaveLength(0);
      expect(all(el, (e) => e.props['data-machine-control'] === 'stop')).toHaveLength(0);
    }
    expect(text(harness(liveModel(probeSnap({ step: 'ready', plan: PLAN })).model).render())).toContain('G10 L20 P1');
  });

  it('without a send: a note says to connect', () => {
    const { model } = liveModel(probeSnap({ step: 'touch' }));
    model.actions.value = {} as unknown as LiveActions;
    const t = harness(model);
    click(button(t.render(), 'probe-cancel'));
    expect(text(one(t.render(), byAttr('data-probe', 'note')))).toBe('Connect a machine to use these controls.');
  });
});
