/**
 * Board → Firmware → Update: the board carries the failed-update mark (machine-worker/flashService.ts `marked`), and
 * how it clears. Only a live banner from the board clears it (bannerWait.ts), so there is no button that forgets it.
 */
import { h, type ComponentChild } from 'preact';
import type { FlashView } from '../../machine-worker/flashService.ts';

export function BootloaderMarkNote({ flash }: { readonly flash: FlashView | null }): ComponentChild {
  if (flash?.marked !== true || flash.phase !== 'failed') return null;
  return h('section', { class: 'insp', 'data-region': 'bootloader-mark' },
    h('header', null, h('h2', null, 'Marked after the last update'), h('span', { class: 'tag warn' }, 'May be in its bootloader')),
    h('p', null, 'Since the last update, Run treats this board as possibly in its bootloader. It sends the board only a bootloader check until it hears the board start.'),
    h('p', { 'data-mark-clear': 'true' }, 'To clear the mark: press Connect, then press Reset on the board when Run asks.'));
}
