/** The open page's view: firmware and its required restore only. */
import { UpdateReleaseChoices } from './ReleaseChoices.ts';
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type FirmwareRelease } from '@synthetos/protocol';
import { boardText, w45, w46, w28, w49 } from '@synthetos/safety';
import { signalText } from '../shell/signal.ts';
import { ConfirmFlash, DownloadCard, Progress } from '../firmware/FlashViews.ts';
import { ConfirmSettings } from '../firmware/ConfirmSettings.ts';
import { bootloaderHardwareVersions } from '../firmware/bootloaderHardware.ts';
import type { ReleaseImage } from '../workspace/model.ts';
import { backupBlocked } from '../live/backup.ts';
import { initialUpdateState, type UpdateController } from './controller.ts';

export function UpdateFlow({ controller, supported, failure }: { readonly controller: UpdateController | null; readonly supported: boolean; readonly failure: string | null }): ComponentChild {
  const state = controller?.state.value ?? initialUpdateState();
  const [image, setImage] = useState<ReleaseImage | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [hardware, setHardware] = useState('');
  const m = state.message;
  const s = m?.snapshot;
  useEffect(() => setImage(null), [s?.epoch]);
  const flash = m?.flash;
  const post = m?.postFlash;
  const hub = state.hub;
  const id = s?.identity;
  const backups = hub?.settings.filter(b => b.boardId === (id?.id ?? flash?.boardId)) ?? [];
  const connected = s !== undefined && s.base !== 'NOT_CONNECTED';
  const busy = flash !== null && flash !== undefined && flash.phase !== 'done' && flash.phase !== 'failed';
  const done = post?.phase === 'clear';
  const selectionBlocked = flash?.bootloader !== undefined ? null : backupBlocked(s ?? null);
  const hv = id?.hv ?? flash?.board?.hv ?? null;
  const act = (run: () => Promise<string | null>): void => { void controller?.action(run); };
  const pick = (release: FirmwareRelease): void => {
    if (controller?.hub === null || controller === null) return;
    if (selecting) return;
    setSelecting(true);
    controller.patch({ error: null });
    void controller.hub.actions.downloadRelease(release).then(async result => { if (!result.ok) { controller.patch({ error: result.message }); return; } await controller.prepareChecklist(); setImage(result.image); }).catch(e => controller.patch({ error: String(e) })).finally(() => setSelecting(false));
  };
  useEffect(() => {
    const holder = document.getElementById('update-done-links');
    const template = document.getElementById('update-blog-link') as HTMLTemplateElement | null;
    if (done && holder && template) holder.replaceChildren(template.content.cloneNode(true));
    return () => holder?.replaceChildren();
  }, [done]);
  return h('div', { class: 'update-flow', 'data-region': 'open-update' },
    failure || state.error ? h('p', { role: 'alert', class: 'update-error' }, failure ?? state.error) : null,
    !supported ? h('section', { class: 'update-card', 'data-step': 'unsupported' }, h('h2', null, 'Use Chrome or Edge on a desktop computer'), h('p', null, 'This browser cannot connect to a USB serial board. Open this page in Chrome or Edge.')) : null,
    supported && !connected && !flash ? h('section', { class: 'update-card', 'data-step': 'connect' },
      h('h2', null, '1. Connect your board'),
      h('p', null, 'Run will identify your TinyG, save a backup here, install a GitHub release and restore your settings. It will not move the machine.'),
      h('ul', { class: 'update-list' }, ['Chrome or Edge on a desktop computer', 'A USB cable', 'Spindle mains switched off'].map(t => h('li', { key: t }, t))),
      h('button', { class: 'primary', disabled: controller === null || state.connecting, onClick: () => void controller?.connect(), 'data-action': 'update-connect' }, state.connecting ? 'Connecting…' : 'Connect'),
    ) : null,
    connected || flash ? h('section', { class: 'update-card update-board', 'data-step': 'board' }, h('div', null,
      h('span', { class: 'kicker' }, '2. Your board and release'), h('h2', null, hv === null ? 'TinyG · hardware not read' : `TinyG v${hv}`),
      h('p', null, `Firmware ${typeof id?.fb === 'number' ? id.fb.toFixed(2) : flash?.board?.fb?.toFixed(2) ?? 'not running'} · ${boardText(id?.id ?? flash?.boardId ?? 'identity not read')}`)),
      h('button', { disabled: busy, onClick: () => void controller?.disconnect(), 'data-action': 'update-disconnect' }, 'Disconnect')) : null,
    flash?.bootloader !== undefined && !busy ? h('section', { class: 'update-card', 'data-step': 'bootloader' },
      h('h2', null, 'The board is in its bootloader.'), h('p', { 'data-safety': 'W28' }, ...signalText(w28())),
      flash.bootloader.startAllowed ? h('button', { onClick: () => act(() => controller!.hub!.actions.startFirmware()) }, 'Start firmware') : null,
      h('label', null, 'Hardware version', h('select', { value: hardware, onChange: (e: Event) => setHardware((e.currentTarget as HTMLSelectElement).value) },
        h('option', { value: '' }, 'Choose the version printed on your board'), ...(hub?.releases.ok ? bootloaderHardwareVersions(hub.releases.list).map(n => h('option', { key: n, value: String(n) }, `TinyG v${n}`)) : []))),
      h('p', null, 'Look for “TinyG v8” on the silkscreen. Check your board’s printed version.'),
      h('button', { disabled: hardware === '', onClick: () => act(() => controller!.hub!.actions.bootloaderHardware(Number(hardware))) }, 'Confirm hardware version'),
    ) : null,
    (connected || flash?.bootloader) && !busy && !done && !post && !image && !state.backup ? h(UpdateReleaseChoices, { hub, hv, blocked: selectionBlocked, selecting, pick }) : null,
    hub?.download ? h(DownloadCard, { download: hub.download }) : null,
    image && m ? h('section', { class: 'update-card', 'data-step': 'checklist' }, h('h2', null, '3. Check before updating'), state.checklistBackup ? h('div', null, h('p', null, 'Download the settings backup before ticking the checklist.'), h('button', { onClick: () => controller?.downloadBackup(state.checklistBackup!), 'data-action': 'checklist-backup' }, 'Download settings backup')) : null, h(ConfirmFlash, { openUpdate: true, view: { message: m }, target: { kind: 'release', image }, onCancel: () => setImage(null), onConfirm: () => { const chosen = image; setImage(null); act(() => controller!.hub!.actions.updateRelease(chosen)); } })) : null,
    state.backup ? h('section', { class: 'update-card', 'data-step': 'backup' }, h('h2', null, '4. Your backup'),
      h('p', null, state.backup.file ? 'Your settings backup is saved on this computer. Download a copy before continuing.' : 'No readable firmware is running. Run will save the board’s stored settings and firmware before writing anything.'),
      state.backup.file ? h('button', { onClick: () => controller?.downloadBackup() }, 'Download backup') : null,
      h('div', { class: 'update-actions' }, h('button', { onClick: () => controller?.answerBackup(false) }, 'Cancel'), h('button', { class: 'primary', onClick: () => controller?.answerBackup(true), 'data-action': 'backup-continue' }, 'Continue with update'))) : null,
    busy && flash ? h('section', { class: 'update-card', 'data-step': 'progress' }, h('h2', null, '5. Updating your board'), h(Progress, { flash }), flash.phase === 'recovery' && flash.countdown !== null ? h('p', { role: 'alert', 'data-safety': 'W49' }, w49({ seconds: flash.countdown })) : null, h('p', null, 'Keep USB connected. Keep spindle mains off.'), h('button', { onClick: () => act(() => controller!.hub!.actions.cancel()) }, 'Cancel update')) : null,
    hub?.step.kind === 'preparing' && !state.backup ? h('p', { role: 'status' }, hub.step.what) : null,
    flash?.phase === 'failed' ? h('section', { class: 'update-card', 'data-step': 'recovery' }, h('h2', null, 'Update stopped'), h('p', { role: 'alert' }, flash.message), h('p', null, 'Keep spindle mains off. Follow the recovery instructions before trying again.'), flash.recoveryOffered ? h('button', { onClick: () => act(() => controller!.hub!.actions.recover()) }, 'Try the update again') : null) : null,
    post && post.phase !== 'clear' ? h('section', { class: 'update-card', 'data-step': 'restore', 'data-post-flash': post.phase },
      h('h2', null, '6. Check your settings'),
      post.phase === 'awaitingRead' ? h('p', { role: 'status' }, 'Reading and comparing your settings with the backup…') : null,
      post.phase === 'restoreRequired' ? h('div', null, h('p', { 'data-safety': 'W45' }, ...signalText(w45({ count: post.differences.length }))),
        h('table', null, h('thead', null, h('tr', null, h('th', null, 'Setting'), h('th', null, 'Backup'), h('th', null, 'Now'))), h('tbody', null, post.differences.map(d => h('tr', { key: d.key }, h('td', null, d.key), h('td', null, String(d.backup)), h('td', null, String(d.board ?? 'not read')))))),
        s?.overlays.includes('UNKNOWN') ? h('div', { class: 'update-verify' }, h('p', null, 'Before restoring settings, check that nothing is moving and the machine is where you expect. This only allows restoring settings here; the workspace needs its own position check.'), h('button', { onClick: () => act(() => controller!.flash({ op: 'restorePositionVerify' })), 'data-action': 'restore-position-verify' }, 'Allow settings restore')) : null,
        h('button', { class: 'primary', disabled: s?.overlays.includes('UNKNOWN') || state.apply.kind === 'writing' || state.apply.kind === 'backingUp', onClick: () => act(() => controller!.hub!.actions.restore()), 'data-action': 'restore-after-flash' }, 'Restore my settings')) : null,
      state.apply.kind === 'writing' || state.apply.kind === 'backingUp' ? h('p', { role: 'status' }, 'Restoring one setting at a time and reading each back…') : null,
      state.apply.kind === 'failed' ? h('p', { role: 'alert' }, state.apply.message) : null,
      post.phase === 'switchCheck' ? h('div', { 'data-step': state.mainsConfirmed ? 'switches' : 'mains' },
        h('p', null, 'Your settings match the backup.'), h('h3', null, '7. Check mains and switches'),
        h('label', null, h('input', { type: 'checkbox', checked: state.mainsConfirmed, onChange: (e: Event) => controller?.patch({ mainsConfirmed: (e.currentTarget as HTMLInputElement).checked }), 'data-action': 'mains-confirm' }), ' Spindle mains are still switched off.'),
        state.mainsConfirmed ? h('div', null, h('p', { 'data-safety': 'W46' }, ...signalText(w46())),
          h('ul', { class: 'update-list' }, post.inputs.map(i => h('li', { key: i.input }, `${i.label}: ${i.seenOpen && i.seenClosed ? 'pressed and released' : i.seenClosed ? 'release it' : 'press it'}`))),
          post.inputs.length === 0 ? h('p', null, 'No limit switches are configured. Confirm to finish.') : null,
          hub?.pollingSwitches ? h('p', { role: 'status' }, 'Watching the switches…') : h('button', { onClick: () => controller?.hub?.actions.startSwitchCheck(), 'data-action': 'switch-test-start' }, 'Start the switch test'),
          h('button', { class: 'primary', disabled: !post.inputs.every(i => i.seenOpen && i.seenClosed), onClick: () => act(() => controller!.hub!.actions.finishSwitchCheck()), 'data-action': 'switch-test-done' }, 'All switches checked')) : null) : null,
    ) : null,
    state.changes.length ? h(ConfirmSettings, { restoreOnly: true, changes: state.changes, boardId: id?.id ?? null, blocked: post?.phase !== 'restoreRequired', onCancel: () => controller?.patch({ changes: [] }), onConfirm: () => void controller?.applyRestore() }) : null,
    done ? h('section', { class: 'update-card', 'data-step': 'done' }, h('h2', null, `8. Done. Your TinyG runs ${id?.fb?.toFixed(2) ?? 'the checked firmware'}.`), h('p', null, 'Your settings are restored and the switch check is complete.'), h('a', { href: '/' }, 'Open the workspace'), h('div', { id: 'update-done-links' })) : null,
    hub && backups.length > 0 ? h('section', { class: 'update-card', 'data-step': 'saved-backups' }, h('h2', null, 'Saved on this computer'), h('ul', { class: 'update-list' }, backups.map(b => h('li', { key: b.id }, h('span', null, `${b.trigger === 'before-update' ? 'Before update' : b.trigger === 'before-apply' ? 'Before restore' : 'Settings'} · ${b.takenAt.replace('T', ' ').slice(0, 16)}`), h('button', { onClick: () => act(async () => { await controller!.hub!.actions.exportSettings(b.id); return null; }) }, 'Download'))))) : null,
  );
}
