/**
 * Board → Firmware → Update: the board carries the failed-update mark (machine-worker/flashService.ts `marked`), and
 * how it clears. Only a live banner from the board clears it (bannerWait.ts), so there is no button that forgets it.
 * When another board on the same port proved, by its banner, that it is not the marked board, the note names the
 * marked board instead (`elsewhere`).
 */
import { h, type ComponentChild } from 'preact';
import { boardText } from '@synthetos/safety';
import type { FlashView } from '../../machine-worker/flashService.ts';

const HOW_TO_CLEAR = 'press Reset on the board';

export function BootloaderMarkNote({ flash }: { readonly flash: FlashView | null }): ComponentChild {
  if (flash?.elsewhere !== undefined) {
    return h('section', { class: 'insp', 'data-region': 'bootloader-mark', 'data-mark-board': 'other' },
      h('header', null, h('h2', null, 'Another board is marked'), h('span', { class: 'tag warn' }, 'May be in its bootloader')),
      h('p', null, `Board ${boardText(flash.elsewhere)} may still be in its bootloader. Connect that board and press Reset.`));
  }
  if (flash?.marked !== true || flash.phase !== 'failed') return null;
  // Said once: a failed update in this tab carries the advice in its message (on the Recovery card below).
  const said = (flash.message ?? '').includes(HOW_TO_CLEAR);
  return h('section', { class: 'insp', 'data-region': 'bootloader-mark' },
    h('header', null, h('h2', null, 'Marked after the last update'), h('span', { class: 'tag warn' }, 'May be in its bootloader')),
    h('p', null, 'Since the last update, Run treats this board as possibly in its bootloader. It sends the board only a bootloader check until it hears the board start.'),
    said ? null : h('p', { 'data-mark-clear': 'true' }, 'To clear the mark: press Connect, then press Reset on the board when Run asks.'));
}
