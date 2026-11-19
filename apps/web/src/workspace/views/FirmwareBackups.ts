/**
 * Board → Firmware, the parts beside Update (owner walk 2026-11-19: no scrolling, so each is its own sub-tab):
 * the firmware image backups read before each update, and custom firmware with the builds trusted on this computer.
 * One column, left-aligned, each section carrying its own action at natural width (owner, 2026-11-03: "never stretch
 * buttons across the screen"). The unsigned-firmware warning (W47) is shown where the decision is made, in the flash
 * confirmation beside C37, not as a permanent banner (OD-9).
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { boardText, w48 } from '@synthetos/safety';
import { ConfirmFlash, type Target } from '../../firmware/FlashViews.ts';
import type { FirmwareActions, FirmwareHubView, LiveView, WorkspaceModel } from '../model.ts';
import { subTabChoice } from './board/subTabs.ts';
import { flashBlocked } from './FirmwareViews.ts';

const fbText = (fb: number | null | undefined): string => (typeof fb === 'number' ? fb.toFixed(2) : 'unknown');
const shortSha = (sha: string): string => `${sha.slice(0, 4)}…${sha.slice(-4)}`;
const dateText = (iso: string): string => iso.replace('T', ' ').slice(0, 16);

async function sha256Of(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Ctx {
  readonly view: LiveView | null;
  readonly fw: FirmwareActions | undefined;
  readonly hub: FirmwareHubView | null;
  readonly blocked: string | null;
  readonly setTarget: (t: Target) => void;
}

/** The confirmation, the last message and the hub's notice, then the part's sections. */
function Frame({ model, region, children }: { readonly model: WorkspaceModel | null; readonly region: string; readonly children: (c: Ctx) => ComponentChild }): ComponentChild {
  const view = model?.live.value ?? null;
  const fw = model?.actions.value?.firmware;
  const hub = view?.firmware ?? null;
  const [target, setTarget] = useState<Target | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const confirm = (t: Target): void => {
    setTarget(null);
    if (fw === undefined) return;
    // The update's progress, check and restore are on the Update sub-tab: go there as it starts.
    subTabChoice.firmware.value = 'update';
    void (t.kind === 'backup' ? fw.putBack(t.id) : t.kind === 'custom' ? fw.flashCustom(t.name, t.text) : fw.updateRelease(t.image)).then(setMsg);
  };
  return h(
    'div',
    { tabindex: 0, class: 'hub', 'data-region': region },
    view !== null && target !== null ? h(ConfirmFlash, { view, target, onCancel: () => setTarget(null), onConfirm: () => confirm(target) }) : null,
    msg === null ? null : h('p', { class: 'backup-progress', role: 'status', 'data-hub-message': 'true' }, msg),
    hub?.notice === null || hub?.notice === undefined ? null : h('p', { class: `backup-progress ${hub.notice.kind === 'ok' ? 'ok' : 'danger'}`, role: 'status' }, hub.notice.text),
    children({ view, fw, hub, blocked: flashBlocked(view), setTarget }),
  );
}

function ImageRow({ f, c, thisBoard }: { readonly f: FirmwareHubView['firmware'][number]; readonly c: Ctx; readonly thisBoard: string | null }): ComponentChild {
  return h(
    'li',
    { key: f.id },
    h('div', { class: 'hub-row-main' }, h('strong', null, `Firmware ${fbText(f.fb)}`), h('span', { class: 'tag' }, 'Before an update'), h('small', null, `${dateText(f.takenAt)} · board ${f.boardId === null ? 'unknown' : boardText(f.boardId)} · fv ${f.fv ?? '?'} · sha256 ${shortSha(f.sha256)} · ${Math.round(f.size / 1024)} KB`)),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'firmware-download', disabled: c.fw === undefined, onClick: () => void c.fw?.downloadFirmware(f.id) }, 'Download .hex'),
      h('button', { type: 'button', class: 'small', 'data-machine-control': 'flash', 'data-action': 'firmware-put-back', disabled: c.blocked !== null || c.fw === undefined || f.boardId !== thisBoard, title: f.boardId !== thisBoard ? 'Only on the board it was read from.' : (c.blocked ?? undefined), onClick: () => c.setTarget({ kind: 'backup', id: f.id, fb: f.fb, sha256: f.sha256 }) }, 'Put this firmware back'),
      h('button', { type: 'button', class: 'small', 'data-action': 'firmware-delete', disabled: c.fw === undefined, onClick: () => void c.fw?.deleteFirmware(f.id) }, 'Delete'),
    ),
  );
}

/** The firmware image backups, each with Download, Put back (on its own board only) and Delete. */
export function ImageBackups({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  return h(Frame, { model, region: 'firmware-hub', children: (c) => {
    const id = c.view?.message?.snapshot.identity?.id;
    const thisBoard = typeof id === 'string' ? id : null;
    const list = c.hub?.firmware ?? [];
    return h(
      'section',
      { class: 'hub-section', 'aria-labelledby': 'hub-images' },
      h('header', { class: 'hub-head' }, h('h2', { id: 'hub-images' }, 'Firmware image backups'), h('span', { class: 'fine' }, 'Read from the board before each update')),
      list.length === 0
        ? h('p', { class: 'fine', 'data-firmware-backups': '0' }, 'None yet. Run reads the whole firmware from the board, with its EEPROM, before every update.')
        : h('ul', { class: 'hub-list', 'data-firmware-backups': String(list.length) }, list.map((f) => h(ImageRow, { key: f.id, f, c, thisBoard }))),
    );
  } });
}

function CustomPick({ c }: { readonly c: Ctx }): ComponentChild {
  return h(
    'label',
    { class: `button small file-pick${c.blocked === null ? '' : ' disabled'}`, title: c.blocked ?? undefined },
    'Choose a .hex file…',
    h('input', {
      type: 'file',
      accept: '.hex',
      class: 'sr-only',
      disabled: c.blocked !== null,
      'data-machine-control': 'flash',
      'data-action': 'custom-file',
      onChange: (e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file !== undefined) void file.text().then(async (text) => c.setTarget({ kind: 'custom', name: file.name, text, sha256: await sha256Of(text) }));
        input.value = '';
      },
    }),
  );
}

function Trusted({ c }: { readonly c: Ctx }): ComponentChild {
  const list = c.hub?.trust ?? [];
  return h(
    'section',
    { class: 'hub-section', 'aria-labelledby': 'hub-trust' },
    h('header', { class: 'hub-head' }, h('h2', { id: 'hub-trust' }, 'Trusted custom builds'), h('span', { class: 'fine' }, 'On this computer only')),
    list.length === 0
      ? h('p', { class: 'fine', 'data-trusted': '0' }, 'None. A custom build stays read-only unless you trust it on its board.')
      : h('ul', { class: 'hub-list', 'data-trusted': String(list.length) }, list.map((t) =>
          h(
            'li',
            { key: `${t.boardId}/${t.sha256}` },
            h('div', { class: 'hub-row-main' }, h('strong', null, boardText(t.name)), h('span', { class: 'tag warn' }, w48()), h('small', null, `board ${boardText(t.boardId)} · fb ${fbText(t.fb)} · sha256 ${shortSha(t.sha256)} · since ${dateText(t.trustedAt)}`)),
            h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'small', 'data-action': 'trust-revoke', disabled: c.fw === undefined, onClick: () => void c.fw?.revoke(t.boardId, t.sha256) }, 'Revoke')),
          ))),
  );
}

/** Custom firmware: choose a .hex file (confirmed with the full warning), and the builds trusted on this computer. */
export function CustomFirmware({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  return h(Frame, { model, region: 'firmware-custom', children: (c) => [
    h(
      'section',
      { key: 'custom', class: 'hub-section', 'aria-labelledby': 'hub-custom' },
      h('header', { class: 'hub-head' }, h('h2', { id: 'hub-custom' }, 'Custom firmware'), h(CustomPick, { c })),
      h('p', { class: 'fine' }, 'Unsigned builds are flashed after a backup and stay read-only until you trust them on this board. The full warning is shown before you confirm.'),
    ),
    h(Trusted, { key: 'trust', c }),
  ] });
}
