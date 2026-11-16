import { h, type ComponentChild } from 'preact';
import type { MotionAxis } from '../../../machine-worker/rpc.ts';
import { uiLevel } from '../../jobWorkflow.ts';
import { type WorkspaceModel } from '../../model.ts';
import { JOG_FEED, JogController, jogKey, MM_PER_IN, motionUi, STEPS_IN, STEPS_MM, type JogTimers, type MotionUi } from '../../motion.ts';
import { jogBlocked } from '../../toolChangeControls.ts';
import { isLive, LIVE_HOOKS, motionNote, STATIC_HOOKS, type Hooks } from './motionHooks.ts';

const PAD: readonly { readonly label: string; readonly text: string; readonly axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>> | null }[] = [
  { label: 'X−, Y+', text: '↖', axes: { x: -1, y: 1 } },
  { label: 'Y+', text: 'Y+', axes: { y: 1 } },
  { label: 'X+, Y+', text: '↗', axes: { x: 1, y: 1 } },
  { label: 'X−', text: 'X−', axes: { x: -1 } },
  { label: 'Go to X0 Y0', text: '⌖', axes: null },
  { label: 'X+', text: 'X+', axes: { x: 1 } },
  { label: 'X−, Y−', text: '↙', axes: { x: -1, y: -1 } },
  { label: 'Y−', text: 'Y−', axes: { y: -1 } },
  { label: 'X+, Y−', text: '↘', axes: { x: 1, y: -1 } },
];

const realTimers: JogTimers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };

/**
 * The jog panel (SAFETY §4.5b, H50, H51): the XY pad and Z, step sizes in mm or inches or Hold, the jog speed,
 * and keyboard jog while the panel has focus. Without a LIVE motion session every control is disabled and
 * carries no handler.
 */
function jogBody({ model, onGoToZero }: JogProps, hk: Hooks): ComponentChild {
  const view = model?.live.value ?? null;
  const ui = motionUi(view);
  const send = model?.actions.value?.motion;
  const enabled = ui.enabled && send !== undefined;
  const [units, setUnits] = hk.state<'mm' | 'in'>('mm');
  const [stepIndex, setStepIndex] = hk.state<number | null>(2);
  const [feed, setFeed] = hk.state<number>(JOG_FEED.default);
  const [note, setNote] = hk.state<string | null>(null);
  const controller = hk.memo(
    () =>
      new JogController((c) => {
        void send?.(c).then((reason) => {
          if (c.op === 'jog') setNote(reason);
        });
      }, realTimers),
    [send],
  );
  hk.effect(() => {
    // Any held jog stops when the window loses focus or the page is hidden, or on any pointer-up (H50).
    const release = (): void => controller.release();
    const hidden = releaseJogOnBlur({ controller });
    addEventListener('blur', release);
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      controller.release();
      removeEventListener('blur', release);
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [controller]);
  const steps = units === 'mm' ? STEPS_MM : STEPS_IN;
  const settings = (): { stepMm: number | null; feed: number } => ({ stepMm: stepIndex === null ? null : (steps[stepIndex] as number) * (units === 'in' ? MM_PER_IN : 1), feed });
  // A held jog keeps its buttons live so the release always arrives (a disabled button gets no pointer-up).
  const live = send !== undefined && (ui.enabled || ui.busy || controller.holding);
  const press = (axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>) => (e: PointerEvent) => {
    if (!enabled) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setNote(null);
    controller.press(axes, settings());
  };
  const jogButton = (label: string, text: string, axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>, cls: string): ComponentChild =>
    h(
      'button',
      {
        type: 'button',
        class: cls,
        'aria-label': label,
        key: label,
        'data-machine-control': 'jog',
        ...(jogBlocked(view?.message?.snapshot, axes) === null ? {} : { title: jogBlocked(view?.message?.snapshot, axes) as string }),
        ...(live && jogBlocked(view?.message?.snapshot, axes) === null ? { onPointerDown: press(axes), onPointerUp: () => controller.release(), onLostPointerCapture: () => controller.release() } : { disabled: true }),
      },
      text,
    );
  const onKeyDown = (e: KeyboardEvent): void => {
    const axes = jogKey(e.key);
    if (axes === null || !live || !document.hasFocus()) return;
    e.preventDefault();
    if (e.repeat || !enabled) return;
    setNote(null);
    controller.press(axes, settings());
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (jogKey(e.key) !== null) controller.release();
  };
  return h(
    'section',
    { class: 'insp sec-jog', 'aria-labelledby': 'jog-title' },
    h('header', null, h('h2', { id: 'jog-title' }, 'Jog')),
    jogPad({ live, ui, onKeyDown, onKeyUp, controller, enabled, onGoToZero, jogButton, steps, units, stepIndex, setStepIndex, setUnits, feed, setFeed }),
    motionNote(note),
  );
}

type JogProps = { readonly model?: WorkspaceModel | null; readonly onGoToZero?: (axes: readonly MotionAxis[]) => void };

function releaseJogOnBlur({ controller }: { readonly controller: JogController }) {
  return (): void => {
    if (document.visibilityState !== 'visible') controller.release();
  };
}

function jogPad({ live, ui, onKeyDown, onKeyUp, controller, enabled, onGoToZero, jogButton, steps, units, stepIndex, setStepIndex, setUnits, feed, setFeed }: { readonly live: boolean; readonly ui: MotionUi; readonly onKeyDown: (e: KeyboardEvent) => void; readonly onKeyUp: (e: KeyboardEvent) => void; readonly controller: JogController; readonly enabled: boolean; readonly onGoToZero: ((axes: readonly MotionAxis[]) => void) | undefined; readonly jogButton: (label: string, text: string, axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>, cls: string) => ComponentChild; readonly steps: readonly number[]; readonly units: string; readonly stepIndex: number | null; readonly setStepIndex: (v: number | null) => void; readonly setUnits: (v: "mm" | "in") => void; readonly feed: number; readonly setFeed: (v: number) => void }): ComponentChild {
  return h(
    'div',
    {
      class: 'jog',
      'aria-disabled': live ? 'false' : 'true',
      tabindex: live ? 0 : -1,
      'data-jog': 'panel',
      'aria-label': 'Jog pad. Arrow keys jog X and Y, Page Up and Page Down jog Z, while this panel has focus.',
      ...(live ? {} : { title: ui.reason ?? undefined }),
      ...(live
        ? {
          onKeyDown,
          onKeyUp,
          // Focus leaving the panel (not moving between its own buttons) ends a held keyboard jog.
          onFocusOut: (e: FocusEvent) => {
            if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) controller.release();
          },
        }
        : {}),
    },
    jogPads({ enabled, onGoToZero, jogButton }),
    jogSteps({ steps, units, stepIndex, enabled, setStepIndex }),
    jogSettings({ units, enabled, setUnits, feed, setFeed })
  );
}

function jogPads({ enabled, onGoToZero, jogButton }: { readonly enabled: boolean; readonly onGoToZero: ((axes: readonly MotionAxis[]) => void) | undefined; readonly jogButton: (label: string, text: string, axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>, cls: string) => ComponentChild }): ComponentChild {
  return h(
    'div',
    { class: 'jog-pads' },
    h(
      'div',
      { class: 'jog-pad', role: 'group', 'aria-label': 'X and Y' },
      PAD.map((p, i) => p.axes === null
        ? h('button', { type: 'button', class: 'j', 'aria-label': p.label, key: p.label, 'data-machine-control': 'zero', ...(enabled && onGoToZero !== undefined ? { onClick: () => onGoToZero(['x', 'y']) } : { disabled: true }) }, p.text)
        : jogButton(p.label, p.text, p.axes, `j${i % 2 === 0 ? ' diag' : ''}`)
      )
    ),
    h('div', { class: 'jog-z', role: 'group', 'aria-label': 'Z' }, jogButton('Z up', 'Z+', { z: 1 }, 'j'), jogButton('Z down', 'Z−', { z: -1 }, 'j'))
  );
}

function jogSteps({ steps, units, stepIndex, enabled, setStepIndex }: { readonly steps: readonly number[]; readonly units: string; readonly stepIndex: number | null; readonly enabled: boolean; readonly setStepIndex: (v: number | null) => void }): ComponentChild {
  return h(
    'div',
    { class: 'seg full', role: 'group', 'aria-label': 'Step size' },
    steps.map((v, i) => h('button', { type: 'button', key: `${units}${v}`, class: stepIndex === i ? 'selected' : undefined, 'aria-pressed': stepIndex === i ? 'true' : 'false', 'data-machine-control': 'jog', ...(enabled ? { onClick: () => setStepIndex(i) } : { disabled: true }) }, String(v))
    ),
    h('button', { type: 'button', class: stepIndex === null ? 'selected' : undefined, 'aria-pressed': stepIndex === null ? 'true' : 'false', 'data-machine-control': 'jog', title: 'Jog while the button or key is held', ...(enabled ? { onClick: () => setStepIndex(null) } : { disabled: true }) }, 'Hold')
  );
}

function jogSettings({ units, enabled, setUnits, feed, setFeed }: { readonly units: string; readonly enabled: boolean; readonly setUnits: (v: "mm" | "in") => void; readonly feed: number; readonly setFeed: (v: number) => void }): ComponentChild {
  return h(
    'div',
    { class: 'jog-settings' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Step units' }, (['mm', 'in'] as const).map((u) => h('button', { type: 'button', key: u, class: units === u ? 'selected' : undefined, 'aria-pressed': units === u ? 'true' : 'false', 'data-machine-control': 'jog', ...(enabled ? { onClick: () => setUnits(u) } : { disabled: true }) }, u))),
    uiLevel.value.value !== 'advanced' ? null : h(
      'label',
      { class: 'jog-feed' },
      h('span', null, 'Jog speed'),
      h('input', {
        type: 'number',
        min: JOG_FEED.min,
        max: JOG_FEED.max,
        step: 10,
        value: feed,
        ...(enabled ? { onInput: (e: Event) => setFeed(Math.min(JOG_FEED.max, Math.max(JOG_FEED.min, Number((e.currentTarget as HTMLInputElement).value) || JOG_FEED.default))) } : { disabled: true }),
        'aria-label': 'Jog speed, mm per minute',
        'data-machine-control': 'jog',
      }),
      h('small', null, 'mm/min')
    )
  );
}

function JogLive(props: JogProps): ComponentChild {
  return jogBody(props, LIVE_HOOKS);
}

export function JogSection(props: JogProps = {}): ComponentChild {
  return isLive(props.model) ? h(JogLive, props) : jogBody(props, STATIC_HOOKS);
}
