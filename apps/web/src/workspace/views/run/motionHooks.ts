import { h, type ComponentChild } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { type WorkspaceModel } from '../../model.ts';


/**
 * The hooks a motion section uses. A section renders with real hooks only while a LIVE motion session can act
 * (the model has the motion action); otherwise it renders once, statically, with every control disabled and no
 * handler (the prerendered page, and the shell tests' tree expansion).
 */
export interface Hooks {
  state<T>(initial: T): [T, (v: T) => void];
  memo<T>(make: () => T, deps: readonly unknown[]): T;
  effect(run: () => void | (() => void), deps: readonly unknown[]): void;
}

export const LIVE_HOOKS: Hooks = {
  state: <T,>(initial: T) => useState<T>(initial) as [T, (v: T) => void],
  memo: (make, deps) => useMemo(make, deps as unknown[]),
  effect: (run, deps) => useEffect(run, deps as unknown[]),
};

export const STATIC_HOOKS: Hooks = { state: <T,>(initial: T): [T, (v: T) => void] => [initial, () => undefined], memo: (make) => make(), effect: () => undefined };

export function isLive(model: WorkspaceModel | null | undefined): boolean {
  return model?.actions.value?.motion !== undefined;
}

export function motionNote(note: string | null): ComponentChild {
  // Only what this panel's own action answered. The session's last motion result ("Paused", "Resumed", "Stopped")
  // is the status strip's, not a line floating under Jog speed (owner, 2026-11-09).
  if (note === null) return null;
  return h('p', { class: 'motion-note', 'data-jog': 'note', role: 'status' }, note);
}
