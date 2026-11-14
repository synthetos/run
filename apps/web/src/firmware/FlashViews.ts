/** Shared flash checklist and progress views. No workspace controls. */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { boardText, c37, c6Boxes, c6Question, w11, w28, w47 } from '@synthetos/safety';
import { signalText } from '../shell/signal.ts';
import type { LiveView, ReleaseImage, FirmwareDownload } from '../workspace/model.ts';
import type { FlashView } from '../machine-worker/flashService.ts';
const fbText = (fb: number | null | undefined): string => typeof fb === 'number' ? fb.toFixed(2) : 'unknown';
const shortSha = (sha: string): string => `${sha.slice(0, 4)}…${sha.slice(-4)}`;
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

export type Target =
  | { readonly kind: 'release'; readonly image: ReleaseImage }
  | { readonly kind: 'backup'; readonly id: string; readonly fb: number | null; readonly sha256: string }
  | { readonly kind: 'custom'; readonly name: string; readonly text: string; readonly sha256: string };

/** The C6 checklist (and C37 for custom firmware), then the question. Nothing starts until every box is ticked. */
export function ConfirmFlash({ view, target, onCancel, onConfirm }: { readonly view: Pick<LiveView, 'message'>; readonly target: Target; readonly onCancel: () => void; readonly onConfirm: () => void }): ComponentChild {
  const boxes = c6Boxes().boxes;
  const [ticked, setTicked] = useState<boolean[]>(boxes.map(() => false));
  const id = view.message?.snapshot.identity;
  const boardId = typeof id?.id === 'string' ? boardText(id.id) : 'unknown board';
  const toBuild = target.kind === 'release' ? fbText(target.image.release.fb) : target.kind === 'backup' ? `${fbText(target.fb)} (firmware backup)` : 'custom';
  const sha = target.kind === 'release' ? target.image.release.sha256 : target.sha256;
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
            ` ${/^\d+\. /.test(b) ? '' : `${i + 1}. `}${b}`,
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

export function Progress({ flash }: { readonly flash: FlashView }): ComponentChild {
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

/** The release image on its way from this site's own origin (OD-10), then its check against the signed entry. */
export function DownloadCard({ download }: { readonly download: FirmwareDownload }): ComponentChild {
  const pct = download.total !== null && download.total > 0 ? Math.min(100, Math.round((download.received / download.total) * 100)) : null;
  const words: Record<FirmwareDownload['phase'], string> = { fetching: 'Downloading', checking: 'Checking the SHA-256', ready: 'Downloaded and checked', failed: 'Not downloaded' };
  return h(
    'section',
    { class: 'insp', 'data-region': 'firmware-download', 'data-download-phase': download.phase },
    h('header', null, h('h2', null, 'Release image'), h('span', { class: `tag ${download.phase === 'failed' ? 'danger' : download.phase === 'ready' ? 'ok' : ''}` }, words[download.phase])),
    h(
      'div',
      { class: 'flash-progress', role: 'status' },
      h('div', { class: 'flash-progress-head' }, h('strong', null, boardText(download.file)), pct === null ? null : h('span', { 'data-download-percent': String(pct) }, `${pct}%`)),
      pct === null ? null : h('div', { class: 'flash-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${pct}%` } })),
      h('p', { class: 'fine' }, `${Math.round(download.received / 1024)} KB${download.total === null ? '' : ` of ${Math.round(download.total / 1024)} KB`} from this site`),
    ),
    download.message === null ? null : h('p', { class: 'backup-progress danger', role: 'alert' }, download.message),
  );
}

