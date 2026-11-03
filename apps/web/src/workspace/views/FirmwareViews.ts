/**
 * The Board view's Firmware tab (the Update panel) and its Firmware & Backups
 * tab (SAFETY §4.8 as amended 2026-11-03, H79-H89; WORKSPACE_FEATURES
 * "Firmware gate, update and backups").
 *
 * Every control that can lead to a flash carries `data-machine-control`
 * `flash`: disabled in the prerendered page and whenever the worker's flasher
 * switch is off (production), and it only asks the worker, which decides
 * (machine-worker/flashService.ts). The page shows the worker's own state:
 * the flash progress, the recovery countdown, the post-flash lock.
 *
 * Strings that carry a signal word come from @synthetos/safety (T-S32).
 * Everything from the board, a file name or a record renders as text.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { boardText, c37, c38, c6Boxes, c6Question, w11, w28, w45, w46, w47, w48, w49, w50 } from '@synthetos/safety';
import { releasesForHardware, type FirmwareRelease } from '@synthetos/protocol';
import { signalText } from '../../shell/signal.ts';
import { RestorePanel } from '../settings/SettingsUi.ts';
import { backupBlocked } from '../../live/backup.ts';
import { Icon } from '../icons.ts';
import { connected, type FirmwareActions, type FirmwareHubView, type LiveView, type WorkspaceModel } from '../model.ts';
import type { FlashView } from '../../machine-worker/flashService.ts';

const fbText = (fb: number | null | undefined): string => (typeof fb === 'number' ? fb.toFixed(2) : 'unknown');
const shortSha = (sha: string): string => `${sha.slice(0, 4)}…${sha.slice(-4)}`;
const dateText = (iso: string): string => iso.replace('T', ' ').slice(0, 16);

const PHASE_WORDS: Readonly<Record<string, string>> = {
  authorizing: 'Checking the image',
  entering: 'Restarting the board into its bootloader',
  recovery: 'Waiting for the bootloader',
  enter: 'Waiting for the bootloader',
  identify: 'Checking the chip and the bootloader',
  backup: 'Reading the current firmware and EEPROM (backup)',
  saving: 'Saving the backups on this computer',
  write: 'Writing the new firmware',
  verify: 'Reading it back to verify',
  final: 'Writing the last page',
  crc: 'Checking the bootloader’s checksum',
  exit: 'Starting the new firmware',
  reconnecting: 'Reconnecting',
  done: 'Done',
  failed: 'Stopped',
};

/** Why flashing is not possible right now, or null. */
export function flashBlocked(view: LiveView | null): string | null {
  const m = view?.message ?? null;
  if (view === null || m === null) return 'Connect a board first.';
  if (m.flasher !== true) return 'Firmware updates are not available on this site.';
  if (m.flash !== null && m.flash !== undefined && m.flash.phase !== 'done' && m.flash.phase !== 'failed') return 'An update is in progress.';
  if (!connected(view)) return 'Connect the board first.';
  const s = m.snapshot;
  if (s.classification === null) return 'Wait until the board is identified.';
  if (s.classification.dialectId === null) return 'This board was not identified as a TinyG. Use recovery if it has no working firmware.';
  return null;
}

type Target =
  | { readonly kind: 'release'; readonly release: FirmwareRelease; readonly localText?: string }
  | { readonly kind: 'backup'; readonly id: string; readonly fb: number | null; readonly sha256: string }
  | { readonly kind: 'custom'; readonly name: string; readonly text: string; readonly sha256: string };

/** The C6 checklist (and C37 for custom firmware), then the question. Nothing starts until every box is ticked. */
function ConfirmFlash({ view, target, onCancel, onConfirm }: { readonly view: LiveView; readonly target: Target; readonly onCancel: () => void; readonly onConfirm: () => void }): ComponentChild {
  const boxes = c6Boxes().boxes;
  const [ticked, setTicked] = useState<boolean[]>(boxes.map(() => false));
  const id = view.message?.snapshot.identity;
  const boardId = typeof id?.id === 'string' ? boardText(id.id) : 'unknown board';
  const toBuild = target.kind === 'release' ? fbText(target.release.fb) : target.kind === 'backup' ? `${fbText(target.fb)} (firmware backup)` : 'custom';
  const sha = target.kind === 'release' ? target.release.sha256 : target.sha256;
  const allTicked = ticked.every((t, i) => t && ticked.slice(0, i).every(Boolean));
  return h(
    'div',
    { class: 'flash-confirm', role: 'dialog', 'aria-label': 'Confirm the firmware update', 'data-region': 'flash-confirm' },
    h('p', { class: 'flash-danger', 'data-safety': 'W11' }, ...signalText(w11())),
    h('p', { class: 'flash-danger', 'data-safety': 'W28' }, ...signalText(w28())),
    target.kind === 'custom' ? h('p', { class: 'flash-warn', 'data-safety': 'W47' }, ...signalText(w47())) : null,
    h(
      'ol',
      { class: 'flash-boxes' },
      boxes.map((b, i) =>
        h(
          'li',
          { key: b },
          h(
            'label',
            null,
            h('input', {
              type: 'checkbox',
              checked: ticked[i],
              disabled: i > 0 && !(ticked[i - 1] ?? false),
              'aria-label': `C6 step ${i + 1}`,
              onChange: (e: Event) => setTicked(ticked.map((t, k) => (k === i ? (e.currentTarget as HTMLInputElement).checked : t))),
            }),
            ` ${b}`,
          ),
        ),
      ),
    ),
    h('p', { class: 'flash-question', 'data-safety': 'C6' }, c6Question({ boardId, fromBuild: fbText(id?.fb), toBuild, sha256Short: shortSha(sha) })),
    target.kind === 'custom' ? h('p', { class: 'flash-question', 'data-safety': 'C37' }, c37({ name: boardText(target.name), sha256Short: shortSha(sha), boardId })) : null,
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'cancel-flash', autofocus: true, onClick: onCancel }, 'Cancel'),
      h('button', { type: 'button', class: 'primary small', 'data-machine-control': 'flash', 'data-action': 'confirm-flash', disabled: !allTicked, onClick: onConfirm }, target.kind === 'custom' ? 'Flash custom firmware' : 'Update now'),
    ),
  );
}

function Progress({ flash }: { readonly flash: FlashView }): ComponentChild {
  const pct = flash.of > 0 ? Math.min(100, Math.round((flash.done / flash.of) * 100)) : null;
  return h(
    'div',
    { class: 'flash-progress', role: 'status', 'data-flash-phase': flash.phase },
    h('div', { class: 'flash-progress-head' }, h('strong', null, PHASE_WORDS[flash.phase] ?? flash.phase), pct === null ? null : h('span', null, `${pct}%`)),
    pct === null ? null : h('div', { class: 'flash-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${pct}%` } })),
    flash.note === null ? null : h('p', { class: 'fine' }, flash.note),
    h('p', { class: 'fine' }, `Flashing ${flash.target.label} · sha256 ${shortSha(flash.target.sha256)}`),
  );
}

function RecoveryCard({ flash, actions }: { readonly flash: FlashView; readonly actions: WorkspaceModel['actions']['value'] }): ComponentChild {
  const counting = flash.phase === 'recovery' && flash.countdown !== null;
  return h(
    'section',
    { class: 'insp flash-recovery', 'data-region': 'flash-recovery' },
    h('header', null, h('h2', null, 'Recovery'), h('span', { class: 'tag danger' }, 'No firmware running')),
    counting
      ? h('p', { class: 'recovery-count', role: 'alert', 'data-safety': 'W49' }, w49({ seconds: flash.countdown ?? 0 }))
      : h('p', null, 'The board has no complete firmware, so it waits in its bootloader. Run flashes it again through the bootloader’s reset window: start recovery, then unplug the USB cable and plug it back in.'),
    h('p', { class: 'flash-danger', 'data-safety': 'W28' }, ...signalText(w28())),
    counting ? null : h('button', { type: 'button', class: 'primary wide', 'data-machine-control': 'flash', 'data-action': 'flash-recover', disabled: actions?.firmware === undefined, onClick: () => void actions?.firmware?.recover() }, 'Start recovery'),
  );
}

function PostFlash({ view, hub }: { readonly view: LiveView; readonly hub: FirmwareHubView | null }): ComponentChild {
  const m = view.message;
  const post = m?.postFlash ?? null;
  if (post === null || post.phase === 'clear') return null;
  return h(
    'section',
    { class: 'insp post-flash', 'data-region': 'post-flash', 'data-post-flash': post.phase },
    h('header', null, h('h2', null, 'After the update'), h('span', { class: 'tag warn' }, 'Jobs, jog and settings locked')),
    post.phase === 'awaitingRead' ? h('p', { role: 'status' }, 'Reading every setting to compare it with your backup…') : null,
    post.phase === 'restoreRequired'
      ? h(
          'div',
          null,
          h('p', { class: 'flash-warn', role: 'alert', 'data-safety': 'W45' }, ...signalText(w45({ count: post.differences.length }))),
          h(
            'table',
            { class: 'diff-table' },
            h('thead', null, h('tr', null, h('th', null, 'Setting'), h('th', null, 'Your backup'), h('th', null, 'Board now'))),
            h('tbody', null, post.differences.map((d) => h('tr', { key: d.key }, h('td', null, h('code', null, d.key)), h('td', null, String(d.backup)), h('td', null, d.board === null ? 'not read' : boardText(String(d.board)))))),
          ),
          h(RestoreButton, { view }),
        )
      : null,
    post.phase === 'switchCheck' ? h(SwitchCheck, { view, hub }) : null,
  );
}

function RestoreButton({ view }: { readonly view: LiveView }): ComponentChild {
  const [msg, setMsg] = useState<string | null>(null);
  return h(
    'div',
    null,
    h(
      'button',
      {
        type: 'button',
        class: 'primary wide',
        'data-machine-control': 'settings-write',
        'data-action': 'restore-after-flash',
        disabled: view.apply.kind === 'backingUp' || view.apply.kind === 'writing',
        onClick: () => void FIRMWARE_ACTIONS.current?.restore().then(setMsg),
      },
      view.apply.kind === 'writing' ? 'Restoring…' : 'Restore my settings',
    ),
    h('p', { class: 'fine' }, 'Run writes your backed-up values one at a time and reads each back. Nothing else is written until they all match.'),
    msg === null ? null : h('p', { class: 'backup-progress danger', role: 'alert' }, msg),
  );
}

function SwitchCheck({ view, hub }: { readonly view: LiveView; readonly hub: FirmwareHubView | null }): ComponentChild {
  const post = view.message?.postFlash;
  const [msg, setMsg] = useState<string | null>(null);
  if (post === null || post === undefined) return null;
  const done = post.inputs.every((i) => i.seenOpen && i.seenClosed);
  return h(
    'div',
    { 'data-region': 'switch-check' },
    h('p', { class: 'flash-warn', role: 'alert', 'data-safety': 'W46' }, ...signalText(w46())),
    post.inputs.length === 0 ? h('p', { class: 'fine' }, 'No limit switches are configured on this board, so there is nothing to press. Confirm to finish.') : null,
    h(
      'ul',
      { class: 'switch-list' },
      post.inputs.map((i) => h('li', { key: i.input, class: i.seenOpen && i.seenClosed ? 'ok' : 'locked', 'data-switch-input': String(i.input), 'data-seen': i.seenOpen && i.seenClosed ? 'both' : i.seenClosed ? 'closed' : i.seenOpen ? 'open' : 'none' }, `${i.label}: ${i.seenOpen && i.seenClosed ? 'seen pressed and released' : i.seenClosed ? 'pressed, now release it' : 'press it'}`)),
    ),
    h(
      'div',
      { class: 'row-actions' },
      hub?.pollingSwitches === true
        ? h('span', { class: 'tag live' }, 'Watching the switches')
        : h('button', { type: 'button', class: 'small', 'data-action': 'switch-test-start', onClick: () => FIRMWARE_ACTIONS.current?.startSwitchCheck() }, 'Start the switch test'),
      h('button', { type: 'button', class: 'primary small', 'data-machine-control': 'flash', 'data-action': 'switch-test-done', disabled: !done, onClick: () => void FIRMWARE_ACTIONS.current?.finishSwitchCheck().then(setMsg) }, 'All switches checked'),
    ),
    msg === null ? null : h('p', { class: 'backup-progress danger', role: 'alert' }, msg),
  );
}

/** The firmware actions of the page, set by the views (preact hooks cannot reach the model inside PostFlash's children). */
const FIRMWARE_ACTIONS: { current: FirmwareActions | null } = { current: null };

function TrustOffer({ view, hub }: { readonly view: LiveView; readonly hub: FirmwareHubView }): ComponentChild {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const installed = hub.installed;
  const s = view.message?.snapshot;
  const id = s?.identity?.id;
  if (installed === null || installed.source !== 'custom' || typeof id !== 'string' || installed.boardId !== id) return null;
  if (hub.trust.some((t) => t.boardId === id && t.sha256 === installed.sha256)) return null;
  return h(
    'section',
    { class: 'insp', 'data-region': 'trust-offer' },
    h('header', null, h('h2', null, 'Custom firmware'), h('span', { class: 'tag warn' }, 'Read only')),
    h('p', null, `This board runs ${boardText(installed.name)}, unsigned custom firmware. It stays read-only unless you trust this exact build on this board.`),
    open
      ? h(
          'div',
          { class: 'flash-confirm' },
          h('p', { 'data-safety': 'C38' }, c38({ name: boardText(installed.name), sha256Short: shortSha(installed.sha256), boardId: boardText(id) })),
          h(
            'div',
            { class: 'row-actions' },
            h('button', { type: 'button', class: 'small', 'data-action': 'trust-cancel', onClick: () => setOpen(false) }, 'Cancel'),
            h('button', { type: 'button', class: 'primary small', 'data-machine-control': 'flash', 'data-action': 'trust-confirm', onClick: () => void FIRMWARE_ACTIONS.current?.trust(id).then((m) => (m === null ? setOpen(false) : setMsg(m))) }, 'Trust this build on this board'),
          ),
        )
      : h('button', { type: 'button', class: 'wide', 'data-machine-control': 'flash', 'data-action': 'trust-open', onClick: () => setOpen(true) }, 'Trust this build on this board…'),
    msg === null ? null : h('p', { class: 'backup-progress danger', role: 'alert' }, msg),
  );
}

export function FirmwareTab({ model, view: viewProp }: { readonly model?: WorkspaceModel | null; readonly view?: LiveView | null }): ComponentChild {
  const view = model?.live.value ?? viewProp ?? null;
  const actions = model?.actions.value ?? null;
  FIRMWARE_ACTIONS.current = actions?.firmware ?? null;
  const hub = view?.firmware ?? null;
  const [target, setTarget] = useState<Target | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const m = view?.message ?? null;
  const s = m?.snapshot ?? null;
  const on = view !== null && connected(view);
  const id = s?.identity ?? null;
  const hv = typeof id?.hv === 'number' ? id.hv : null;
  const blocked = flashBlocked(view);
  const flash = m?.flash ?? null;
  const running = flash !== null && flash.phase !== 'done' && flash.phase !== 'failed';
  const hw = hub !== null && hub.releases.ok ? releasesForHardware(hub.releases.list, hv) : null;
  const trusted = s?.classification?.approvalSource === 'trusted';
  const old = m?.oldFirmware ?? null;
  const start = (): void => {
    const t = target;
    const fw = actions?.firmware;
    setTarget(null);
    if (t === null || fw === undefined) return;
    const run = t.kind === 'release' ? fw.updateRelease(t.release, t.localText) : t.kind === 'backup' ? fw.putBack(t.id) : fw.flashCustom(t.name, t.text);
    void run.then(setMsg);
  };
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { tabindex: 0, class: 'list-panel releases-panel', 'data-region': 'firmware-releases' },
      h(
        'div',
        { class: 'fw-current' },
        h('div', { class: 'fw-chip' }, Icon('chip', 26)),
        h(
          'div',
          { class: 'grow' },
          h('span', { class: 'kicker' }, 'On this board'),
          h('h2', { 'data-board-firmware': on && typeof id?.fb === 'number' ? fbText(id.fb) : '' }, on && typeof id?.fb === 'number' ? `Firmware ${fbText(id.fb)}` : 'Firmware not read'),
          h('p', null, on ? `Hardware version ${id?.hv === undefined ? 'unknown' : boardText(String(id.hv))}${typeof id?.id === 'string' ? ` · board ${boardText(id.id)}` : ''}` : 'Connect a board to read its firmware version.'),
        ),
        trusted ? h('span', { class: 'tag warn', 'data-safety': 'W48' }, w48()) : null,
      ),
      old === null ? null : h('p', { class: 'flash-warn pad', role: 'alert', 'data-safety': 'W50', 'data-old-firmware': 'true' }, w50({ fb: fbText(old.fb), minimum: fbText(old.minimumFb) })),
      h('div', { class: 'section-heading tight' }, h('h2', null, 'Releases'), h('span', { class: 'fine' }, 'Signed builds for this board’s hardware')),
      hub === null || !hub.releases.ok
        ? h('p', { class: 'fine pad', 'data-releases': 'none' }, hub === null || hub.releases.ok ? 'Loading the signed release list…' : `No signed release list for this site: ${hub.releases.reason}.`)
        : hw === null || hw.releases.length === 0
          ? h('p', { class: 'fine pad', 'data-releases': 'empty' }, on ? `No signed release for hardware version ${hv ?? 'unknown'} yet.` : 'Connect a board to see the releases for its hardware.')
          : h(
              'ul',
              { class: 'releases' },
              hw.releases.map((r) => {
                const installed = typeof id?.fb === 'number' && Math.round(id.fb * 100) === Math.round(r.fb * 100);
                return h(
                  'li',
                  { key: r.file, 'data-release': r.file },
                  h('div', { class: 'rel-ver' }, h('strong', null, fbText(r.fb)), h('small', null, r.date), r.recommended ? h('span', { class: 'tag ok' }, 'Recommended') : null, r.simulatorOnly ? h('span', { class: 'tag mock' }, 'Simulated board only') : null),
                  h(
                    'div',
                    { class: 'rel-notes' },
                    h('h3', null, `TinyG ${r.dialect === 'tinyg-en' ? 'edge-next' : '440'} ${fbText(r.fb)} · fv ${r.fv}`),
                    h('p', { class: 'changelog' }, r.changelog),
                    h('p', { class: 'installed' }, `${r.file} · sha256 ${shortSha(r.sha256)} · ${Math.round(r.size / 1024)} KB${installed ? ' · installed' : ''}`),
                    h(
                      'div',
                      { class: 'row-actions' },
                      h('button', { type: 'button', class: r.recommended ? 'primary small' : 'small', 'data-machine-control': 'flash', 'data-action': 'update-release', disabled: blocked !== null || running || actions?.firmware === undefined, title: blocked ?? undefined, onClick: () => setTarget({ kind: 'release', release: r }) }, installed ? 'Flash again' : `Update to ${fbText(r.fb)}`),
                      h(
                        'label',
                        { class: `button small file-pick${blocked === null ? '' : ' disabled'}` },
                        'Use a local copy…',
                        h('input', {
                          type: 'file',
                          accept: '.hex',
                          class: 'sr-only',
                          disabled: blocked !== null || running,
                          'data-machine-control': 'flash',
                          'data-action': 'release-local',
                          onChange: (e: Event) => {
                            const input = e.currentTarget as HTMLInputElement;
                            const file = input.files?.[0];
                            if (file !== undefined) void file.text().then((text) => setTarget({ kind: 'release', release: r, localText: text }));
                            input.value = '';
                          },
                        }),
                      ),
                    ),
                  ),
                );
              }),
            ),
    ),
    h(
      'aside',
      { tabindex: 0, class: 'inspector', 'aria-label': 'Firmware update' },
      view !== null && target !== null ? h(ConfirmFlash, { view, target, onCancel: () => setTarget(null), onConfirm: start }) : null,
      flash !== null && running && flash.phase !== 'recovery'
        ? h(
            'section',
            { class: 'insp', 'data-region': 'firmware-update' },
            h('header', null, h('h2', null, 'Updating'), h('span', { class: 'tag warn' }, 'Do not unplug')),
            h('p', { class: 'flash-danger', 'data-safety': 'W11' }, ...signalText(w11())),
            h(Progress, { flash }),
            flash.wrote ? null : h('button', { type: 'button', class: 'small', 'data-action': 'flash-cancel', onClick: () => void actions?.firmware?.cancel().then(setMsg) }, 'Cancel (nothing written yet)'),
          )
        : null,
      flash !== null && (flash.phase === 'recovery' || (flash.phase === 'failed' && flash.recoveryOffered)) ? h(RecoveryCard, { flash, actions }) : null,
      flash !== null && flash.phase === 'failed' && !flash.recoveryOffered
        ? h('section', { class: 'insp', 'data-region': 'flash-failed' }, h('header', null, h('h2', null, 'Update stopped')), h('p', { role: 'alert' }, flash.message ?? 'The update stopped.'), h('p', { class: 'fine' }, flash.wrote ? 'Pages were written: use recovery.' : 'Nothing was written. The board starts its old firmware again.'), h('button', { type: 'button', class: 'small', 'data-action': 'flash-dismiss', onClick: () => void actions?.firmware?.dismiss() }, 'Dismiss'))
        : null,
      flash !== null && flash.phase === 'done'
        ? h(
            'section',
            { class: 'insp', 'data-region': 'flash-done' },
            h('header', null, h('h2', null, 'Updated'), h('span', { class: `tag ${flash.versionCheck?.ok === true ? 'ok' : 'warn'}` }, flash.versionCheck === null ? 'Reconnecting' : flash.versionCheck.ok ? 'Version checked' : 'Version differs')),
            h('p', { 'data-version-check': flash.versionCheck === null ? 'pending' : flash.versionCheck.ok ? 'ok' : 'differs' }, flash.versionCheck === null ? 'Waiting for the board to answer…' : `The board reports ${fbText(flash.versionCheck.reported)}${flash.versionCheck.expected === null ? '' : ` (expected ${fbText(flash.versionCheck.expected)})`}.`),
            flash.result === null ? null : h('p', { class: 'fine' }, `${flash.result.written} pages written, ${flash.result.unchanged} already right, checksum 0x${flash.result.crc.toString(16).padStart(4, '0')}${flash.result.resyncs > 0 ? `, ${flash.result.resyncs} retries` : ''}.`),
            flash.message === null ? null : h('p', { class: 'fine' }, flash.message, ' ', h('button', { type: 'button', class: 'small', 'data-action': 'flash-reconnect', onClick: () => void actions?.firmware?.reconnect().then(setMsg) }, 'Reconnect')),
          )
        : null,
      view !== null ? h(PostFlash, { view, hub }) : null,
      view !== null && hub !== null ? h(TrustOffer, { view, hub }) : null,
      target === null && !running && (flash === null || flash.phase === 'done' || (flash.phase === 'failed' && !flash.recoveryOffered))
        ? h(
            'section',
            { class: 'insp', 'data-region': 'firmware-plan' },
            h('header', null, h('h2', null, 'Update'), h('span', { class: 'tag' }, m?.flasher === true ? 'Bench and staging' : 'Not on this site')),
            h('ol', { class: 'fw-plan' }, ['Back up every setting', 'Restart into the bootloader; back up the current firmware', 'Write, then read back to verify', 'Reconnect and check the version', 'Compare and restore your settings; check the switches'].map((t, i) => h('li', { key: t }, h('span', null, String(i + 1)), t))),
            h('p', { class: 'fine', 'data-flash-blocked': blocked === null ? 'no' : 'yes' }, blocked ?? 'Choose a release on the left, put a firmware backup back, or flash your own in Firmware & Backups.'),
          )
        : null,
      msg === null ? null : h('p', { class: 'backup-progress danger', role: 'alert', 'data-flash-message': 'true' }, msg),
    ),
  );
}

export function BackupsHub({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const actions = model?.actions.value ?? null;
  const fw = actions?.firmware;
  FIRMWARE_ACTIONS.current = fw ?? null;
  const hub = view?.firmware ?? null;
  const snapshot = view?.message?.snapshot ?? null;
  const readBlocked = backupBlocked(snapshot);
  const status = view?.backup ?? { kind: 'idle' as const };
  const flashBlockedWhy = flashBlocked(view);
  const thisBoard = typeof snapshot?.identity?.id === 'string' ? snapshot.identity.id : null;
  const [target, setTarget] = useState<Target | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const say = (p: Promise<string | null>): void => void p.then(setMsg);
  return h(
    'div',
    { class: 'configure-grid hub-grid' },
    h(
      'div',
      { tabindex: 0, class: 'list-panel backups-panel', 'data-region': 'backups-hub' },
      h(
        'div',
        { class: 'section-heading tight' },
        h('h2', null, 'Settings backups'),
        h(
          'button',
          { type: 'button', class: 'primary small', 'data-action': 'backup', 'data-machine-control': 'read', disabled: readBlocked !== null || status.kind === 'reading' || model === null, 'aria-describedby': 'backup-why', onClick: () => model?.actions.value?.backup() },
          Icon('download', 16),
          status.kind === 'reading' ? 'Reading…' : 'Back up settings',
        ),
      ),
      h('p', { class: 'fine', id: 'backup-why', 'data-backup': readBlocked === null ? 'ready' : 'blocked' }, readBlocked ?? 'Every setting, read one GET at a time and kept on this computer. Run also backs up automatically before every settings apply and every firmware update.'),
      status.kind === 'reading' ? h('p', { class: 'backup-progress', role: 'status', 'data-backup': 'reading' }, `Reading ${status.token === '' ? 'the last answer' : `"${status.token}"`}: ${status.done} of ${status.of}`) : null,
      status.kind === 'saved' ? h('p', { class: 'backup-progress ok', role: 'status', 'data-backup': 'saved' }, `Saved ${status.name}: ${status.answered} groups${status.unanswered === 0 ? '' : `, ${status.unanswered} unanswered (listed in the file)`}.`) : null,
      status.kind === 'failed' ? h('p', { class: 'backup-progress danger', role: 'alert', 'data-backup': 'failed' }, `The backup was not saved: ${status.message}`) : null,
      hub === null || hub.settings.length === 0
        ? h('p', { class: 'fine', 'data-settings-backups': '0' }, 'No settings backups on this computer yet.')
        : h(
            'ul',
            { class: 'hub-list', 'data-settings-backups': String(hub.settings.length) },
            hub.settings.map((b) =>
              h(
                'li',
                { key: b.id, 'data-backup-trigger': b.trigger },
                h('div', { class: 'hub-row-main' }, h('strong', null, dateText(b.takenAt)), h('span', { class: 'tag' }, TRIGGER_WORDS[b.trigger]), h('small', null, `board ${b.boardId === null ? 'unknown' : boardText(b.boardId)} · firmware ${fbText(b.fb)}${b.boardId !== null && thisBoard !== null && b.boardId !== thisBoard ? ' · another board' : ''}`)),
                hub.compare?.id === b.id ? h('p', { class: 'fine', 'data-compare': 'result' }, hub.compare.changes === 0 ? `Matches the board (${hub.compare.same} settings).` : `${hub.compare.changes} differ from the board: ${hub.compare.keys.slice(0, 12).join(', ')}${hub.compare.keys.length > 12 ? '…' : ''}.`) : null,
                h(
                  'div',
                  { class: 'row-actions' },
                  h('button', { type: 'button', class: 'small', 'data-action': 'backup-compare', disabled: fw === undefined, onClick: () => fw !== undefined && say(fw.compareSettings(b.id)) }, 'Compare'),
                  h('button', { type: 'button', class: 'small', 'data-machine-control': 'settings-write', 'data-action': 'backup-restore', disabled: fw === undefined || view?.message?.settingsWrites !== true, onClick: () => fw !== undefined && say(fw.stageSettings(b.id)) }, 'Restore…'),
                  h('button', { type: 'button', class: 'small', 'data-action': 'backup-export', disabled: fw === undefined, onClick: () => void fw?.exportSettings(b.id) }, 'Export'),
                  h('button', { type: 'button', class: 'small', 'data-action': 'backup-delete', disabled: fw === undefined, onClick: () => void fw?.deleteSettings(b.id) }, 'Delete'),
                ),
              ),
            ),
          ),
      h(
        'label',
        { class: `button small file-pick${fw === undefined ? ' disabled' : ''}` },
        'Import a backup file…',
        h('input', {
          type: 'file',
          accept: 'application/json,.json',
          class: 'sr-only',
          disabled: fw === undefined,
          'data-action': 'backup-import',
          onChange: (e: Event) => {
            const input = e.currentTarget as HTMLInputElement;
            const file = input.files?.[0];
            if (file !== undefined && fw !== undefined) void file.text().then((t) => say(fw.importSettings(t)));
            input.value = '';
          },
        }),
      ),
      h('div', { class: 'section-heading tight' }, h('h2', null, 'Firmware image backups'), h('span', { class: 'fine' }, 'Read from the board before each update')),
      hub === null || hub.firmware.length === 0
        ? h('p', { class: 'fine', 'data-firmware-backups': '0' }, 'None yet. Run reads the whole firmware from the board, with its EEPROM, before every update.')
        : h(
            'ul',
            { class: 'hub-list', 'data-firmware-backups': String(hub.firmware.length) },
            hub.firmware.map((f) =>
              h(
                'li',
                { key: f.id },
                h('div', { class: 'hub-row-main' }, h('strong', null, `Firmware ${fbText(f.fb)}`), h('span', { class: 'tag' }, 'Before an update'), h('small', null, `${dateText(f.takenAt)} · board ${f.boardId === null ? 'unknown' : boardText(f.boardId)} · fv ${f.fv ?? '?'} · sha256 ${shortSha(f.sha256)} · ${Math.round(f.size / 1024)} KB`)),
                h(
                  'div',
                  { class: 'row-actions' },
                  h('button', { type: 'button', class: 'small', 'data-action': 'firmware-download', disabled: fw === undefined, onClick: () => void fw?.downloadFirmware(f.id) }, 'Download .hex'),
                  h(
                    'button',
                    { type: 'button', class: 'small', 'data-machine-control': 'flash', 'data-action': 'firmware-put-back', disabled: flashBlockedWhy !== null || fw === undefined || f.boardId !== thisBoard, title: f.boardId !== thisBoard ? 'Only on the board it was read from.' : (flashBlockedWhy ?? undefined), onClick: () => setTarget({ kind: 'backup', id: f.id, fb: f.fb, sha256: f.sha256 }) },
                    'Put this firmware back',
                  ),
                  h('button', { type: 'button', class: 'small', 'data-action': 'firmware-delete', disabled: fw === undefined, onClick: () => void fw?.deleteFirmware(f.id) }, 'Delete'),
                ),
              ),
            ),
          ),
      h('div', { class: 'section-heading tight' }, h('h2', null, 'Custom firmware'), h('span', { class: 'tag warn' }, 'Unsigned')),
      h('p', { class: 'flash-warn', 'data-safety': 'W47' }, ...signalText(w47())),
      h(
        'label',
        { class: `button small file-pick${flashBlockedWhy === null ? '' : ' disabled'}` },
        'Choose a .hex file…',
        h('input', {
          type: 'file',
          accept: '.hex',
          class: 'sr-only',
          disabled: flashBlockedWhy !== null,
          'data-machine-control': 'flash',
          'data-action': 'custom-file',
          onChange: (e: Event) => {
            const input = e.currentTarget as HTMLInputElement;
            const file = input.files?.[0];
            if (file !== undefined) void file.text().then(async (text) => setTarget({ kind: 'custom', name: file.name, text, sha256: await sha256Of(text) }));
            input.value = '';
          },
        }),
      ),
      h('div', { class: 'section-heading tight' }, h('h2', null, 'Trusted custom builds'), h('span', { class: 'fine' }, 'On this computer only')),
      hub === null || hub.trust.length === 0
        ? h('p', { class: 'fine', 'data-trusted': '0' }, 'None. A custom build stays read-only unless you trust it on its board.')
        : h(
            'ul',
            { class: 'hub-list', 'data-trusted': String(hub.trust.length) },
            hub.trust.map((t) =>
              h(
                'li',
                { key: `${t.boardId}/${t.sha256}` },
                h('div', { class: 'hub-row-main' }, h('strong', null, boardText(t.name)), h('span', { class: 'tag warn' }, w48()), h('small', null, `board ${boardText(t.boardId)} · fb ${fbText(t.fb)} · sha256 ${shortSha(t.sha256)} · since ${dateText(t.trustedAt)}`)),
                h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'small', 'data-action': 'trust-revoke', disabled: fw === undefined, onClick: () => void fw?.revoke(t.boardId, t.sha256) }, 'Revoke')),
              ),
            ),
          ),
    ),
    h(
      'aside',
      { tabindex: 0, class: 'inspector', 'aria-label': 'Restore and flash' },
      view !== null && target !== null
        ? h(ConfirmFlash, {
            view,
            target,
            onCancel: () => setTarget(null),
            onConfirm: () => {
              const t = target;
              setTarget(null);
              if (fw === undefined) return;
              say(t.kind === 'backup' ? fw.putBack(t.id) : t.kind === 'custom' ? fw.flashCustom(t.name, t.text) : fw.updateRelease(t.release, t.localText));
            },
          })
        : null,
      msg === null ? null : h('p', { class: 'backup-progress', role: 'status', 'data-hub-message': 'true' }, msg),
      hub?.notice === null || hub?.notice === undefined ? null : h('p', { class: `backup-progress ${hub.notice.kind === 'ok' ? 'ok' : 'danger'}`, role: 'status' }, hub.notice.text),
      h(RestorePanel, { view }),
    ),
  );
}

const TRIGGER_WORDS: Readonly<Record<string, string>> = { manual: 'On demand', 'before-apply': 'Before a settings apply', 'before-update': 'Before an update', import: 'Imported' };

async function sha256Of(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
