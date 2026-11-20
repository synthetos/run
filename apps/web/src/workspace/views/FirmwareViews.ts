import { ConfirmFlash, Progress, DownloadCard, type Target } from '../../firmware/FlashViews.ts';
/**
 * The Board view's Firmware tab (the Update panel, then the firmware image backups, custom firmware and trusted
 * builds) and its Backups tab (settings backups); until 2026-11-09 these were the Firmware and Firmware & Backups
 * tabs (SAFETY §4.8 as amended 2026-11-03 and 2026-11-09, H79-H89; WORKSPACE_FEATURES
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
import { useEffect, useState } from 'preact/hooks';
import { bootloaderHardwareVersions } from '../../firmware/bootloaderHardware.ts';
import { releaseRequest } from '../boardNavigation.ts';
import { boardText, c38, w11, w28, w45, w46, w48, w49, w50 } from '@synthetos/safety';
import { signalText } from '../../shell/signal.ts';
import { uiLevel } from '../jobWorkflow.ts';
import { reviewOpen } from '../settings/reviewState.ts';
import { Icon } from '../icons.ts';
import { trustOffered } from '../trustOffer.ts';
import { connected, type FirmwareActions, type FirmwareHubView, type LiveView, type WorkspaceModel } from '../model.ts';
import type { FlashView } from '../../machine-worker/flashService.ts';
import { shownBoard } from './firmwareBoard.ts';
import { BootloaderMarkNote } from './BootloaderMarkNote.ts';
import { Dismissable } from '../notes/Dismissable.ts';
import { FirmwareReleaseList } from './FirmwareReleaseList.ts';
import { useReleasePick } from './releasePick.ts';
import type { MotionCommand } from '../../machine-worker/rpc.ts';

/** Next to an older release's button (first-time walk C8): what a downgrade does to the board's settings. */
export { DOWNGRADE_NOTE } from './FirmwareReleaseList.ts';

const fbText = (fb: number | null | undefined): string => (typeof fb === 'number' ? fb.toFixed(2) : 'unknown');
const shortSha = (sha: string): string => `${sha.slice(0, 4)}…${sha.slice(-4)}`;

/** Why flashing is not possible right now, or null. */

/**
 * The first firmware build whose fb identifies the N66 fix: 450.02 (firmware maintainer, 2026-11-05). edge-next still
 * reports 450.01 after the fix merges, so only the 450.02 tag can be told apart; every build below it shows the note.
 */
const N66_FIXED_FB = 450.02;
export function flashBlocked(view: LiveView | null): string | null {
  const m = view?.message ?? null;
  if (view === null || m === null) return 'Connect a board first.';
  if (m.flasher !== true) return 'Firmware updates are not available on this site.';
  if (m.flash !== null && m.flash !== undefined && m.flash.phase !== 'done' && m.flash.phase !== 'failed') return 'An update is in progress.';
  if (m.flash?.bootloader !== undefined && m.flash.board?.hv !== null && m.flash.board?.hv !== undefined) return null;
  if (!connected(view)) return 'Connect the board first.';
  const s = m.snapshot;
  if (s.classification === null) return 'Wait until the board is identified.';
  if (s.classification.dialectId === null) return 'This board was not identified as a TinyG. Use recovery if it has no working firmware.';
  return null;
}

function RecoveryCard({ flash, actions }: { readonly flash: FlashView; readonly actions: WorkspaceModel['actions']['value'] }): ComponentChild {
  const counting = flash.phase === 'recovery' && flash.countdown !== null;
  // Only a run that wrote to the flash can have left the board without firmware.
  const tag = flash.wrote ? h('span', { class: 'tag danger' }, 'No firmware running') : h('span', { class: 'tag warn', 'data-recovery-wrote': 'false' }, 'Nothing written');
  return h(
    'section',
    { class: 'insp flash-recovery', 'data-region': 'flash-recovery' },
    h('header', null, h('h2', null, 'Recovery'), tag),
    flash.wrote ? null : h('p', null, 'Nothing was written to the board. Its old firmware is still there.'),
    counting
      ? h('p', { class: 'recovery-count', role: 'alert', 'data-safety': 'W49' }, w49({ seconds: flash.countdown ?? 0 }))
      // A marked board: the mark note above says it may be in its bootloader and how the mark clears.
      : h('p', null, flash.marked === true ? 'You can also try the update again. Do not unplug it during the update.' : 'The board may still be in its bootloader. Try the update again. Do not unplug it during the update.'),
    flash.message === null ? null : h('p', { role: 'alert' }, flash.message),
    h('p', { class: 'flash-danger', 'data-safety': 'W28' }, ...signalText(w28())),
    counting ? null : h('button', { type: 'button', class: 'primary wide', 'data-machine-control': 'flash', 'data-action': 'flash-recover', disabled: actions?.firmware === undefined, onClick: () => void actions?.firmware?.recover() }, 'Try the update again'),
  );
}

function PostFlash({ view, hub }: { readonly view: LiveView; readonly hub: FirmwareHubView | null }): ComponentChild {
  const m = view.message;
  const post = m?.postFlash ?? null;
  if (post === null) return null;
  if (post.phase === 'clear') return h('div', { 'data-region': 'restore-summary' }, post.restoreNotes?.map(note => h('p', { key: note }, note)));
  return h(
    'section',
    { class: 'insp post-flash', 'data-region': 'post-flash', 'data-post-flash': post.phase },
    post.restoreNotes?.map(note => h('p', { key: note }, note)),
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
          view.message?.snapshot.overlays.includes('UNKNOWN') === true
            ? h(
                'div',
                { class: 'post-flash-unknown', 'data-region': 'post-flash-unknown' },
                h('p', { class: 'fine' }, 'The board restarted for the update, so run does not trust its position. Check that nothing is moving and the machine is where you expect, then confirm. That moves nothing, and it lets the restore write.'),
                h('button', { type: 'button', class: 'small', 'data-machine-control': 'verify', 'data-action': 'post-flash-verify', onClick: () => void MOTION.current?.({ op: 'positionVerify' }) }, 'I’ve checked the machine'),
              )
            : null,
          h(RestoreButton, { view }),
        )
      : null,
    post.phase === 'switchCheck' ? h(SwitchCheck, { view, hub }) : null,
  );
}

function RestoreButton({ view }: { readonly view: LiveView }): ComponentChild {
  const [msg, setMsg] = useState<string | null>(null);
  return h('div', null,
    h(
      'button',
      {
        type: 'button',
        class: 'primary wide',
        'data-machine-control': 'settings-write',
        'data-action': 'restore-after-flash',
        disabled: view.apply.kind === 'backingUp' || view.apply.kind === 'writing',
        // The staged values open in the review panel (Board settings spec §5.2), where Apply asks C5.
        onClick: () => void FIRMWARE_ACTIONS.current?.restore().then((m) => { setMsg(m); reviewOpen.value = m === null; }),
      },
      view.apply.kind === 'writing' ? 'Restoring…' : 'Restore my settings',
    ),
    h('p', { class: 'fine' }, 'Your backed-up values become pending changes and open for review. Apply writes them one at a time and reads each back. Nothing else is written until they all match.'),
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
/** The page's motion action (positionVerify after the board restarted), set by the views like FIRMWARE_ACTIONS. */
const MOTION: { current: ((command: MotionCommand) => Promise<string | null>) | null } = { current: null };

function TrustOffer({ view, hub }: { readonly view: LiveView; readonly hub: FirmwareHubView }): ComponentChild {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const installed = hub.installed;
  const id = view.message?.snapshot.identity?.id;
  if (!trustOffered(view, hub) || installed === null || typeof id !== 'string') return null;
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

/** The release asked for by the update offer or the setup wizard (boardNavigation.ts): kept marked while this view is open. */
function useAskedRelease(): string | null {
  const [focusRelease, setFocusRelease] = useState<string | null>(null);
  const asked = releaseRequest.value;
  useEffect(() => {
    if (asked === null) return;
    setFocusRelease(asked);
    releaseRequest.value = null;
  }, [asked]);
  return focusRelease;
}

export function FirmwareTab({ model, view: viewProp }: { readonly model?: WorkspaceModel | null; readonly view?: LiveView | null }): ComponentChild {
  const view = model?.live.value ?? viewProp ?? null;
  const actions = model?.actions.value ?? null;
  FIRMWARE_ACTIONS.current = actions?.firmware ?? null;
  MOTION.current = actions?.motion ?? null;
  const hub = view?.firmware ?? null;
  const [target, setTarget] = useState<Target | null>(null);
  const [chooseHardware, setChooseHardware] = useState(false);
  const [hardwareChoice, setHardwareChoice] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const m = view?.message ?? null;
  const s = m?.snapshot ?? null;
  const on = view !== null && connected(view);
  const id = s?.identity ?? null;
  const blocked = flashBlocked(view);
  const flash = m?.flash ?? null;
  // During an update the session is closed: the board as last read, from the flash view (firmwareBoard.ts).
  const shown = shownBoard(on, id, flash, boardText);
  const running = flash !== null && flash.phase !== 'done' && flash.phase !== 'failed';
  const advanced = uiLevel.value.value === 'advanced';
  const focusRelease = useAskedRelease();
  const trusted = s?.classification?.approvalSource === 'trusted';
  const old = m?.oldFirmware ?? null;
  const start = (): void => {
    const t = target;
    const fw = actions?.firmware;
    setTarget(null);
    if (t === null || fw === undefined) return;
    const run = t.kind === 'release' ? fw.updateRelease(t.image) : t.kind === 'backup' ? fw.putBack(t.id) : fw.flashCustom(t.name, t.text);
    void run.then(setMsg);
  };
  const download = hub?.download ?? null;
  const fetching = download !== null && (download.phase === 'fetching' || download.phase === 'checking');
  const { pick, pickLocal } = useReleasePick({ actions, hub, setMsg, setTarget, blocked, running, fetching });
  // C6 takes the Update part's whole area while it is open, the releases and the side column set aside, so every
  // warning, box and button fits without scrolling (owner 167).
  if (view !== null && target !== null) return h(ConfirmFlash, { view, target, wide: true, onCancel: () => setTarget(null), onConfirm: start });
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
          h('h2', { 'data-board-firmware': shown.kind === 'live' && shown.fb !== null ? fbText(shown.fb) : '', 'data-board-shown': shown.kind }, shown.heading),
          h('p', null, shown.detail),
        ),
        trusted ? h('span', { class: 'tag warn', 'data-safety': 'W48' }, w48()) : null,
      ),
      // N66 (firmware maintainer, 2026-11-05): every shipped TinyG build; an accuracy limit, not a block (SAFETY H78).
      on && typeof id?.fb === 'number' && Math.round(id.fb * 100) < Math.round(N66_FIXED_FB * 100)
        ? h('p', { class: 'fine pad', 'data-known-issue': 'n66' }, 'Known issue in this firmware: after long jobs, especially with pauses, the position may end a step or two off. Check it before a job that needs it exact. The fix is coming in a later release.')
        : null,
      old === null ? null : h('p', { class: 'flash-warn pad', role: 'alert', 'data-safety': 'W50', 'data-old-firmware': 'true' }, w50({ fb: fbText(old.fb), minimum: fbText(old.minimumFb) })),
      h(FirmwareReleaseList, { hub, shown, advanced, focusRelease, blocked, running, fetching, enabled: actions?.firmware !== undefined, pick, pickLocal }),
    ),
    h(
      'aside',
      { tabindex: 0, class: 'inspector', 'aria-label': 'Firmware update' },
      download !== null && target === null && !running ? h(DownloadCard, { download }) : null,
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
      flash?.bootloader !== undefined && !flash.recoveryOffered ? h('section', { class: 'insp', 'data-region': 'bootloader-found' },
        h('h2', null, 'The board is in its bootloader.'),
        flash.message === null ? null : h('p', { role: 'alert' }, flash.message),
        flash.bootloader.startAllowed ? h('button', { type: 'button', class: 'primary', 'data-action': 'start-firmware', onClick: () => void actions?.firmware?.startFirmware().then(setMsg) }, 'Start firmware') : null,
        h('button', { type: 'button', 'data-action': 'bootloader-update', disabled: m?.flasher !== true, onClick: () => setChooseHardware(true) }, 'Update firmware'),
        chooseHardware ? h('div', null,
          h('label', null, 'Hardware version printed on the board', h('select', { value: hardwareChoice, onChange: (event: Event) => setHardwareChoice((event.currentTarget as HTMLSelectElement).value) },
            h('option', { value: '' }, 'Choose the printed version…'),
            ...(hub?.releases.ok === true ? bootloaderHardwareVersions(hub.releases.list).map(hv => h('option', { value: String(hv) }, String(hv))) : []))),
          h('p', null, 'Look for “TinyG v8” on the silkscreen; check your board’s printed version. Run cannot read it in the bootloader.'),
          h('button', { type: 'button', disabled: hardwareChoice === '', onClick: () => void actions?.firmware?.bootloaderHardware(Number(hardwareChoice)).then(setMsg) }, 'Confirm hardware version'),
        ) : null,
      ) : null,
      h(BootloaderMarkNote, { flash }), flash !== null && (flash.phase === 'recovery' || (flash.phase === 'failed' && flash.recoveryOffered)) ? h(RecoveryCard, { flash, actions }) : null,
      flash !== null && flash.phase === 'failed' && !flash.recoveryOffered && flash.bootloader === undefined
        ? h('section', { class: 'insp', 'data-region': 'flash-failed' }, h('header', null, h('h2', null, 'Update stopped')), h('p', { role: 'alert' }, flash.message ?? 'The update stopped.'), h('p', { class: 'fine' }, flash.wrote ? 'Pages were written: use recovery.' : 'The board may still be in its bootloader.'), h('button', { type: 'button', class: 'small', 'data-action': 'flash-dismiss', onClick: () => void actions?.firmware?.dismiss() }, 'Dismiss'))
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
            blocked === null
              ? h(Dismissable, { id: 'firmware/update-hint', label: 'the update hint', inNotes: false }, h('p', { class: 'fine', 'data-flash-blocked': 'no' }, 'Choose a release on the left, or below: put a firmware backup back, or flash your own build.'))
              : h('p', { class: 'fine', 'data-flash-blocked': 'yes' }, blocked),
          )
        : null,
      msg === null ? null : h('p', { class: 'backup-progress danger', role: 'alert', 'data-flash-message': 'true' }, msg),
    ),
  );
}

