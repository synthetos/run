/**
 * Connect on a board marked after a failed update (machine-worker/bannerWait.ts): the worker listens for the board's
 * banner and the person presses Reset meanwhile. The dialog says what to do, with the worker's countdown; when the
 * wait runs out, Try again starts another wait on the same port (the worker's `reconnect`, no port choice).
 */
import { signal } from '@preact/signals';
import { Fragment, h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import type { BannerWaitView } from '../../../machine-worker/bannerWait.ts';
import type { FlashView } from '../../../machine-worker/flashService.ts';
import type { LiveActions } from '../../model.ts';
import { belowStrip } from '../../ui.ts';

/** The flash view whose expired wait the person closed: hidden until the next Connect (a new view id). */
const closedFor = signal<number | null>(null);

/** The wait to show for this flash view, or null. */
export function shownBannerWait(flash: FlashView | null | undefined): BannerWaitView | null {
  const wait = flash?.bannerWait ?? null;
  return wait === null || flash?.id === closedFor.value ? null : wait;
}

function Waiting({ seconds }: { readonly seconds: number }): ComponentChild {
  return h(Fragment, null,
    h('p', { class: 'banner-wait-do' }, 'Press the Reset button on the board now (or switch the board’s power off and on, keeping USB connected).'),
    h('p', { class: 'banner-wait-count', role: 'status', 'data-banner-wait-seconds': String(seconds) }, `Run is listening for the board to start: ${seconds} s.`),
    h('p', { class: 'fine' }, 'Since the last update, the board may still be in its bootloader. Run connects only after it hears the board start.'));
}

function Expired({ flashId, actions }: { readonly flashId: number; readonly actions: LiveActions | null }): ComponentChild {
  const [msg, setMsg] = useState<string | null>(null);
  const retry = (): void => {
    setMsg(null);
    actions?.cancel();
    void actions?.firmware?.reconnect().then(setMsg);
  };
  const close = (): void => {
    closedFor.value = flashId;
    actions?.cancel();
  };
  return h(Fragment, null,
    h('p', null, 'Run did not hear the board start. It still treats the board as possibly in its bootloader.'),
    h('p', null, 'Press Try again, then press Reset on the board while Run listens. If it never starts, use Recovery in Board → Firmware.'),
    msg === null ? null : h('p', { class: 'danger', role: 'alert' }, msg),
    h('div', { class: 'row-actions banner-wait-actions' },
      h('button', { type: 'button', class: 'button', 'data-action': 'banner-close', onClick: close }, 'Close'),
      h('button', { type: 'button', class: 'button primary', 'data-action': 'banner-retry', disabled: actions?.firmware === undefined, onClick: retry }, 'Try again')));
}

/** The modal below the strip while Connect listens for a marked board's banner, or after the wait ran out. */
export function BannerWaitDialog({ flash, actions }: { readonly flash: FlashView | null | undefined; readonly actions: LiveActions | null }): ComponentChild {
  const wait = shownBannerWait(flash);
  if (wait === null || flash === null || flash === undefined) return null;
  const waiting = wait.phase === 'waiting';
  return h('div', { class: 'dialog-wrap confirm-modal', role: 'presentation', ref: belowStrip },
    h('div', { class: 'dialog banner-wait', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'banner-wait-title', 'data-region': 'banner-wait', 'data-banner-wait': wait.phase },
      h('div', { class: 'dialog-head' }, h('h2', { id: 'banner-wait-title' }, waiting ? 'Press Reset on the board' : 'The board did not start')),
      waiting ? h(Waiting, { seconds: wait.seconds }) : h(Expired, { flashId: flash.id, actions })));
}
