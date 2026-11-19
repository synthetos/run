/**
 * Every site-wide "Update firmware" reaches the update itself (owner 169-170, 2026-11-19): Board → Firmware → Update
 * with the recommended release's flow started, which opens C6. Where nothing can start now (no updater, no list, C6
 * or an update already showing), the read-only notice shows no button at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { signal } from '@preact/signals';
import type { FirmwareRelease, FirmwareReleases } from '@synthetos/protocol';
import { boardTab, firmwareSubTab, releaseRequest, updateRequest, viewRequest } from '../src/workspace/boardNavigation.ts';
import type { LiveView, WorkspaceModel } from '../src/workspace/model.ts';
import { BoardNotices } from '../src/workspace/settings/BoardNotices.ts';
import { goToUpdate, updateStart } from '../src/workspace/updateStart.ts';
import { blockAction } from '../src/workspace/ControlBlockCard.ts';
import { confirmsOpen } from '../src/firmware/FlashViews.ts';
import { all, byAttr, root } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';

const rel = (fb: number): FirmwareRelease =>
  ({ hv: 8, fb, fv: 0.97, dialect: 'tinyg-en', part: 'x192a3', file: `tinyg-${fb.toFixed(2)}.hex`, sha256: 'a'.repeat(64), size: 1, date: '2026-11-09', changelog: '', recommended: fb === 450.06, simulatorOnly: false, repo: null, tag: null }) as FirmwareRelease;
const LIST = { env: 'staging', issuedMs: 0, expiresMs: 1, boards: [{ hv: 8, minimumFb: 450.02, releases: [rel(450.02), rel(450.06)] }] } as unknown as FirmwareReleases;

type Extra = { readonly flasher?: boolean; readonly releases?: unknown; readonly flash?: unknown; readonly postFlash?: unknown; readonly download?: unknown };
/** The owner's 449.01 board with the updater on and the signed list loaded, unless `extra` says otherwise. */
function owner(extra: Extra = {}): LiveView {
  const v = boardView(OWNER_449);
  const m = v.message as NonNullable<LiveView['message']>;
  const releases = 'releases' in extra ? extra.releases : { ok: true, list: LIST };
  return {
    ...v,
    message: { ...m, flasher: extra.flasher ?? true, flash: extra.flash ?? null, postFlash: extra.postFlash ?? null },
    ...(releases === undefined ? {} : { firmware: { releases, download: extra.download ?? null } }),
  } as unknown as LiveView;
}
const model = (v: LiveView): WorkspaceModel => ({ live: signal(v), actions: signal({ backup: () => undefined }) }) as unknown as WorkspaceModel;
const updateButtons = (v: LiveView) => all(root(h(BoardNotices, { model: model(v) })), byAttr('data-action', 'notice-update'));

afterEach(() => {
  boardTab.value = 'overview';
  firmwareSubTab.value = null;
  releaseRequest.value = null;
  updateRequest.value = null;
  viewRequest.value = null;
  confirmsOpen.value = 0;
});

describe('updateStart: the release a site-wide Update firmware starts, or null when nothing can act', () => {
  it('the owner’s 449.01 with the updater and the list: the newest listed release', () => {
    expect(updateStart(owner())?.file).toBe('tinyg-450.06.hex');
  });
  it('null without an updater, without the list, while C6 or an update or its settings check shows, or while an image downloads', () => {
    expect(updateStart(owner({ flasher: false }))).toBeNull();
    expect(updateStart(owner({ releases: undefined }))).toBeNull();
    expect(updateStart(owner({ releases: { ok: false, reason: 'down' } }))).toBeNull();
    expect(updateStart(owner({ flash: { phase: 'write', wrote: true } }))).toBeNull();
    expect(updateStart(owner({ postFlash: { phase: 'restoreRequired' } }))).toBeNull();
    expect(updateStart(owner({ download: { phase: 'fetching' } }))).toBeNull();
    confirmsOpen.value = 1;
    expect(updateStart(owner())).toBeNull();
  });
});

describe('the read-only notice’s Update firmware', () => {
  it('starts the recommended release’s flow on Board → Firmware → Update', () => {
    const [button] = updateButtons(owner());
    expect(button).toBeDefined();
    (button?.props['onClick'] as () => void)();
    expect(boardTab.value).toBe('firmware');
    expect(firmwareSubTab.value).toBe('update');
    expect(updateRequest.value).toBe('tinyg-450.06.hex');
    expect(releaseRequest.value).toBe('tinyg-450.06.hex');
  });
  it('is not drawn when it could not act: C6 open, an update running, no updater, no list', () => {
    confirmsOpen.value = 1;
    expect(updateButtons(owner())).toEqual([]);
    confirmsOpen.value = 0;
    expect(updateButtons(owner({ flash: { phase: 'backup', wrote: false } }))).toEqual([]);
    expect(updateButtons(owner({ flasher: false }))).toEqual([]);
    expect(updateButtons(owner({ releases: undefined }))).toEqual([]);
    expect(updateButtons(owner())).toHaveLength(1);
  });
});

describe('the other Update firmware buttons reach the update too', () => {
  it('goToUpdate starts the release when it can, and otherwise opens Firmware → Update', () => {
    goToUpdate(owner());
    expect(updateRequest.value).toBe('tinyg-450.06.hex');
    expect(viewRequest.value).toBe('board');
    updateRequest.value = null;
    goToUpdate(owner({ releases: undefined }));
    expect(updateRequest.value).toBeNull();
    expect(boardTab.value).toBe('firmware');
    expect(firmwareSubTab.value).toBe('update');
  });
  it('the Position card’s and Run step’s Update firmware (blockAction) start it', () => {
    blockAction('update', model(owner()));
    expect(updateRequest.value).toBe('tinyg-450.06.hex');
  });
});
