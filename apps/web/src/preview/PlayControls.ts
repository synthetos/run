/**
 * Play preview's controls (owner, 2026-11-09; SAFETY H15 and T-S41 amended, OD-25): Play or Pause, the speed
 * (1×, 2×, 5×, 10×), and under reduced motion "Next move" in place of Play. Shown only when Play may be offered
 * (usePlay.ts `available`): never while a job runs or the board moves. While a session is on, the drawing says
 * "Preview at programmed speeds: not timed like the machine" (PlayNotice).
 */
import { h, type ComponentChild } from 'preact';
import { PLAY_SPEEDS } from '@synthetos/gcode-view';
import type { PlayView } from './usePlay.ts';

export const PLAY_NOTICE = 'Preview at programmed speeds: not timed like the machine';

export function PlayControls({ play }: { readonly play: PlayView }): ComponentChild {
  if (!play.available) return null;
  const toggle = play.reducedMotion
    ? h('button', { type: 'button', class: 'small play-toggle', 'data-action': 'play-step', onClick: () => play.step() }, 'Next move')
    : h('button', { type: 'button', class: 'small play-toggle', 'data-action': 'play-toggle', 'aria-pressed': play.playing ? 'true' : 'false', onClick: () => (play.playing ? play.pause() : play.play()) }, play.playing ? 'Pause' : 'Play');
  return h(
    'div',
    { class: 'play-controls', role: 'group', 'aria-label': 'Play preview', 'data-preview': 'play' },
    toggle,
    play.reducedMotion
      ? null
      : h('span', { class: 'seg play-speeds', role: 'group', 'aria-label': 'Play speed' }, PLAY_SPEEDS.map((s) => h('button', { type: 'button', key: String(s), class: play.speed === s ? 'selected' : undefined, 'aria-pressed': play.speed === s ? 'true' : 'false', 'data-play-speed': String(s), onClick: () => play.setSpeed(s) }, `${String(s)}×`))),
    play.active ? h('button', { type: 'button', class: 'small link play-stop', 'data-action': 'play-stop', onClick: () => play.stop() }, 'End preview') : null,
  );
}

/** The notice over the drawing while a play session is on. Always visible then. */
export function PlayNotice({ play }: { readonly play: PlayView }): ComponentChild {
  return play.active ? h('p', { class: 'play-notice', role: 'status', 'data-preview': 'play-notice' }, PLAY_NOTICE) : null;
}
