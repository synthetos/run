/**
 * Board → Firmware → Update: the cards for a failed, recovering or finished update (FirmwareViews.ts places them).
 * Each says only what Run knows, and says each thing once (owner reports 2026-11-19 and 2026-11-20).
 */
import { h, type ComponentChild } from 'preact';
import { w28, w49 } from '@synthetos/safety';
import type { FlashView } from '../../machine-worker/flashService.ts';
import { signalText } from '../../shell/signal.ts';
import type { WorkspaceModel } from '../model.ts';

type Actions = WorkspaceModel['actions']['value'];

const fbText = (fb: number | null | undefined): string => (typeof fb === 'number' ? fb.toFixed(2) : 'unknown');

/** The flash view the Update part shows: none while it only notes another board's mark (BootloaderMarkNote shows that). */
export function shownFlash(flash: FlashView | null | undefined): FlashView | null {
  return flash === null || flash === undefined || flash.elsewhere !== undefined ? null : flash;
}

/** The view already says the board may be in its bootloader: its message (the advice), or the mark note. */
function saysBootloader(flash: FlashView): boolean {
  return flash.marked === true || (flash.message ?? '').includes('may still be in its bootloader');
}

/** A failed update that offers no recovery: what stopped it, then Dismiss. */
export function FlashFailedCard({ flash, actions }: { readonly flash: FlashView; readonly actions: Actions }): ComponentChild {
  const fine = flash.wrote ? 'Pages were written: use recovery.' : saysBootloader(flash) ? null : 'The board may still be in its bootloader.';
  return h('section', { class: 'insp', 'data-region': 'flash-failed' },
    h('header', null, h('h2', null, 'Update stopped')),
    h('p', { role: 'alert' }, flash.message ?? 'The update stopped.'),
    fine === null ? null : h('p', { class: 'fine' }, fine),
    h('button', { type: 'button', class: 'small', 'data-action': 'flash-dismiss', onClick: () => void actions?.firmware?.dismiss() }, 'Dismiss'));
}

/** Recovery after a failed update: what happened first, then the way out, then W28. */
export function RecoveryCard({ flash, actions }: { readonly flash: FlashView; readonly actions: Actions }): ComponentChild {
  const counting = flash.phase === 'recovery' && flash.countdown !== null;
  // Only a run that wrote to the flash can have left the board without firmware. Run knows only what it wrote: a
  // board found in its bootloader may hold no firmware either way.
  const tag = flash.wrote ? h('span', { class: 'tag danger' }, 'No firmware running') : h('span', { class: 'tag warn', 'data-recovery-wrote': 'false' }, 'Nothing written');
  const retry = saysBootloader(flash) ? 'You can also try the update again. Do not unplug it during the update.' : 'The board may still be in its bootloader. Try the update again. Do not unplug it during the update.';
  return h('section', { class: 'insp flash-recovery', 'data-region': 'flash-recovery' },
    h('header', null, h('h2', null, 'Recovery'), tag),
    flash.wrote ? null : h('p', null, 'Run wrote nothing.'),
    flash.message === null ? null : h('p', { role: 'alert' }, flash.message),
    counting ? h('p', { class: 'recovery-count', role: 'alert', 'data-safety': 'W49' }, w49({ seconds: flash.countdown ?? 0 })) : h('p', null, retry),
    h('p', { class: 'flash-danger', 'data-safety': 'W28' }, ...signalText(w28())),
    counting ? null : h('button', { type: 'button', class: 'primary wide', 'data-machine-control': 'flash', 'data-action': 'flash-recover', disabled: actions?.firmware === undefined, onClick: () => void actions?.firmware?.recover() }, 'Try the update again'));
}

function versionLine(check: FlashView['versionCheck']): string {
  if (check === null) return 'Waiting for the board to answer…';
  return `The board reports ${fbText(check.reported)}${check.expected === null ? '' : ` (expected ${fbText(check.expected)})`}.`;
}

/** The update finished (or the board started after a marked Connect): the version check, then the counts. */
export function FlashDoneCard({ flash, actions, onMessage }: { readonly flash: FlashView; readonly actions: Actions; readonly onMessage: (message: string | null) => void }): ComponentChild {
  const check = flash.versionCheck;
  const r = flash.result;
  return h('section', { class: 'insp', 'data-region': 'flash-done' },
    h('header', null, h('h2', null, check?.ok === false ? 'Not updated' : 'Updated'), h('span', { class: `tag ${check?.ok === true ? 'ok' : 'warn'}` }, check === null ? 'Reconnecting' : check.ok ? 'Version checked' : 'Version differs')),
    h('p', { 'data-version-check': check === null ? 'pending' : check.ok ? 'ok' : 'differs' }, versionLine(check)),
    r === null ? null : h('p', { class: 'fine' }, `${r.written} pages written, ${r.unchanged} already right, checksum 0x${r.crc.toString(16).padStart(4, '0')}${r.resyncs > 0 ? `, ${r.resyncs} retries` : ''}.`),
    flash.message === null ? null : h('p', { class: 'fine' }, flash.message, ' ', h('button', { type: 'button', class: 'small', 'data-action': 'flash-reconnect', onClick: () => void actions?.firmware?.reconnect().then(onMessage) }, 'Reconnect')));
}
