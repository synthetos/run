import { beforeEach, expect, it, vi } from 'vitest';
import { listenDialogDismiss, useDialogDismiss } from '../src/workspace/dialogs/useDialogDismiss.ts';
import { installEscapeStop } from '../src/live/tabStop.ts';

const hooks = vi.hoisted(() => ({ refs: [] as { current: unknown }[], index: 0, asking: false, effect: null as null | (() => (() => void) | undefined) }));
vi.mock('preact/hooks', () => ({
  useRef: (value: unknown) => hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current: value }),
  useState: () => [hooks.asking, (value: boolean) => { hooks.asking = value; }],
  useLayoutEffect: (effect: () => (() => void) | undefined) => { hooks.effect = effect; },
}));
beforeEach(() => { vi.unstubAllGlobals(); hooks.refs = []; hooks.index = 0; hooks.asking = false; hooks.effect = null; });
class Doc extends EventTarget {
  roots: Root[] = [];
  activeElement: { isConnected: boolean; focus: () => void; closest: () => null | object } | null = null;
  fallback = { focus: vi.fn() };
  querySelectorAll() { return this.roots; }
  querySelector() { return this.fallback; }
}
class Root extends EventTarget {
  visible = true;
  readonly ownerDocument: Doc;
  constructor(ownerDocument: Doc) { super(); this.ownerDocument = ownerDocument; ownerDocument.roots.push(this); }
  getClientRects() { return this.visible ? [{}] : []; }
}
function event(type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(props)) Object.defineProperty(e, key, { value });
  return e;
}
function setup() {
  const doc = new Doc(); const root = new Root(doc); const close = vi.fn();
  return { doc, root, close };
}
it('Escape from the body closes and still reaches T-S18 pause, without cancelling it', () => {
  const { doc, root, close } = setup(); const pause = vi.fn();
  const add = vi.spyOn(doc, 'addEventListener');
  installEscapeStop(doc as unknown as Document, pause);
  const stop = listenDialogDismiss(root as unknown as HTMLElement, close);
  expect(add.mock.calls[0]?.[2]).toEqual({ capture: true });
  expect(add.mock.calls[1]?.[2]).toBeUndefined();
  const escape = event('keydown', { key: 'Escape', target: 'body' });
  doc.dispatchEvent(escape); expect(pause).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  expect(escape.defaultPrevented).toBe(false);
  doc.dispatchEvent(event('keydown', { key: 'Tab' })); expect(close).toHaveBeenCalledOnce();
  stop(); doc.dispatchEvent(event('keydown', { key: 'Escape' })); expect(close).toHaveBeenCalledOnce();
});
it('only a complete outside click closes: inside clicks, drags and cancelled presses do not', () => {
  const { root, close } = setup(); const stop = listenDialogDismiss(root as unknown as HTMLElement, close);
  root.dispatchEvent(event('click')); expect(close).not.toHaveBeenCalled();
  root.dispatchEvent(event('pointerdown', { target: 'inside', button: 0 })); root.dispatchEvent(event('click')); expect(close).not.toHaveBeenCalled();
  root.dispatchEvent(event('pointerdown', { button: 0 })); root.dispatchEvent(event('click', { target: 'inside' })); expect(close).not.toHaveBeenCalled();
  root.dispatchEvent(event('pointerdown', { button: 0 })); root.dispatchEvent(event('pointercancel')); root.dispatchEvent(event('click')); expect(close).not.toHaveBeenCalled();
  root.dispatchEvent(event('pointerdown', { button: 2 })); root.dispatchEvent(event('click')); expect(close).not.toHaveBeenCalled();
  root.dispatchEvent(event('pointerdown', { button: 0 })); root.dispatchEvent(event('click')); expect(close).toHaveBeenCalledOnce();
  stop(); root.dispatchEvent(event('pointerdown', { button: 0 })); root.dispatchEvent(event('click')); expect(close).toHaveBeenCalledOnce();
});
it('only the top visible dialog dismisses', () => {
  const { doc, root, close } = setup(); const second = new Root(doc); const closeSecond = vi.fn();
  const stop = listenDialogDismiss(root as unknown as HTMLElement, close);
  const stopSecond = listenDialogDismiss(second as unknown as HTMLElement, closeSecond);
  doc.dispatchEvent(event('keydown', { key: 'Esc' })); expect(close).not.toHaveBeenCalled(); expect(closeSecond).toHaveBeenCalledOnce();
  second.visible = false; doc.dispatchEvent(event('keydown', { key: 'Escape' })); expect(close).toHaveBeenCalledOnce();
  stopSecond(); stop();
});
it('the hook prompts for dirty drafts, keeps editing, uses the latest state and restores focus', async () => {
  const { doc, root, close } = setup();
  const opener = { isConnected: true, focus: vi.fn(), closest: () => null }; doc.activeElement = opener; vi.stubGlobal('document', doc);
  let hook = useDialogDismiss(close, true); hook.ref.current = root as unknown as HTMLDivElement;
  doc.activeElement = { isConnected: true, focus: vi.fn(), closest: () => null }; // child autofocus
  const stop = hooks.effect?.();
  doc.dispatchEvent(event('keydown', { key: 'Escape' })); expect(hooks.asking).toBe(true); expect(close).not.toHaveBeenCalled();
  hook.keepEditing(); expect(hooks.asking).toBe(false);
  root.dispatchEvent(event('pointerdown', { button: 0 })); root.dispatchEvent(event('click')); expect(hooks.asking).toBe(true);
  hook.discard(); expect(close).toHaveBeenCalledOnce();
  hooks.index = 0; hook = useDialogDismiss(close, false);
  doc.dispatchEvent(event('keydown', { key: 'Escape' })); expect(close).toHaveBeenCalledTimes(2);
  stop?.(); await Promise.resolve(); expect(opener.focus).toHaveBeenCalledOnce();
});
it('focus restoration skips a replacement dialog and falls back when the opener was removed', async () => {
  const { doc, root, close } = setup();
  const opener = { isConnected: false, focus: vi.fn(), closest: () => null as null | object }; doc.activeElement = opener; vi.stubGlobal('document', doc);
  const hook = useDialogDismiss(close); hook.ref.current = root as unknown as HTMLDivElement;
  let stop = hooks.effect?.(); stop?.(); await Promise.resolve(); expect(doc.fallback.focus).toHaveBeenCalledOnce();
  stop = hooks.effect?.(); opener.closest = () => ({}); stop?.(); await Promise.resolve(); expect(doc.fallback.focus).toHaveBeenCalledOnce();
});
it('an unmounted hook installs no listener', () => {
  useDialogDismiss(vi.fn()); expect(hooks.effect?.()).toBeUndefined();
});

it('a plain card does not steal clicks, focus, or Escape from pause or an open dialog', async () => {
  const { doc, root, close } = setup(); doc.roots = [];
  const pause = vi.fn(); installEscapeStop(doc as unknown as Document, pause);
  const hook = useDialogDismiss(close, false, null, true); hook.ref.current = root as unknown as HTMLDivElement;
  const stop = hooks.effect?.();
  root.dispatchEvent(event('pointerdown', { button: 0 })); root.dispatchEvent(event('click')); expect(close).not.toHaveBeenCalled();
  const modal = new Root(doc);
  doc.dispatchEvent(event('keydown', { key: 'Escape' })); expect(pause).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  modal.visible = false;
  const escape = event('keydown', { key: 'Escape' }); doc.dispatchEvent(escape);
  expect(close).toHaveBeenCalledOnce(); expect(pause).toHaveBeenCalledTimes(2); expect(escape.defaultPrevented).toBe(false);
  stop?.(); await Promise.resolve(); expect(doc.fallback.focus).not.toHaveBeenCalled();
});
