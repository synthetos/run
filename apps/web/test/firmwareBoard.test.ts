/**
 * Board → Firmware while an update runs (owner, bench 2, 2026-11-09): the session closes for the bootloader, and the
 * tab showed "Firmware not read. Connect a board…" mid-update. It now shows the board as last read and the target,
 * and after the update the board read back, never the not-connected text.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { FirmwareTab } from '../src/workspace/views/FirmwareViews.ts';
import { shownBoard } from '../src/workspace/views/firmwareBoard.ts';
import type { FlashView } from '../src/machine-worker/flashService.ts';
import type { LiveView } from '../src/workspace/model.ts';

const same = (s: string): string => s;
const BOARD = { id: '3Y2462-WWR', hv: 8, fb: 450.02, fv: 0.97 };

function flashView(patch: Partial<FlashView> = {}): FlashView {
  return {
    id: 1,
    phase: 'write',
    done: 40,
    of: 385,
    note: null,
    source: 'release',
    target: { fb: 450.02, label: '450.02 (signed release)', sha256: 'a'.repeat(64) },
    boardId: BOARD.id,
    board: BOARD,
    countdown: null,
    wrote: true,
    message: null,
    recoveryOffered: false,
    versionCheck: null,
    result: null,
    ...patch,
  };
}

describe('shownBoard', () => {
  it('connected: the live identity', () => {
    expect(shownBoard(true, { id: '3Y2462-WWR', hv: 8, fb: 450.02 }, null, same)).toMatchObject({ kind: 'live', heading: 'Firmware 450.02', detail: 'Hardware version 8 · board 3Y2462-WWR', hv: 8, fb: 450.02 });
  });

  it('an update running with the session closed: the board as last read and the target', () => {
    const shown = shownBoard(false, null, flashView(), same);
    expect(shown).toMatchObject({ kind: 'updating', heading: 'Updating 3Y2462-WWR: 450.02 → 450.02 (signed release)', hv: 8, fb: 450.02, id: '3Y2462-WWR' });
    expect(shown.detail).toBe('Hardware version 8 · board 3Y2462-WWR · as read before the update');
    expect(shownBoard(false, null, flashView({ phase: 'reconnecting', source: 'backup', target: { fb: 450.01, label: 'x', sha256: '' } }), same).heading).toBe('Updating 3Y2462-WWR: 450.02 → 450.01 (firmware backup)');
    expect(shownBoard(false, null, flashView({ source: 'custom', target: { fb: null, label: 'x', sha256: '' }, board: { ...BOARD, id: null, fb: null } }), same).heading).toBe('Updating the board: unknown → the chosen image (unsigned custom firmware)');
  });

  it('done but not read back: what the board reported, or that it is being read, or how to read it', () => {
    expect(shownBoard(false, null, flashView({ phase: 'done', versionCheck: { expected: 450.02, reported: 450.02, ok: true } }), same)).toMatchObject({ kind: 'updated', detail: 'The board reports 450.02.', fb: 450.02 });
    expect(shownBoard(false, null, flashView({ phase: 'done' }), same).detail).toBe('Reading the board again…');
    expect(shownBoard(false, null, flashView({ phase: 'done', message: 'The port is not available' }), same).detail).toBe('Not read back yet: Reconnect to read the board.');
  });

  it('stopped: the board as last read; no flash view: not connected', () => {
    expect(shownBoard(false, null, flashView({ phase: 'failed' }), same)).toMatchObject({ kind: 'stopped', heading: 'Firmware 450.02 (last read)' });
    expect(shownBoard(false, null, null, same)).toMatchObject({ kind: 'none', heading: 'Firmware not read' });
    expect(shownBoard(false, null, flashView({ board: null }), same).kind).toBe('none');
  });
});

describe('Board → Firmware during an update', () => {
  it('shows "Updating 3Y2462-WWR: 450.02 → 450.02 (signed release)" and the releases for hv 8, not "Connect a board"', () => {
    const release = { hv: 8, fb: 450.02, fv: 0.97, dialect: 'tinyg-en', part: 'x192a3', file: 'tinyg-450.02.hex', sha256: 'b'.repeat(64), size: 200_000, date: '2026-11-07', changelog: 'c', recommended: true, simulatorOnly: false, repo: null, tag: null };
    const view = {
      message: { snapshot: { base: 'NOT_CONNECTED', identity: null, classification: null, values: {} }, flash: flashView(), flasher: true, oldFirmware: null },
      firmware: { releases: { ok: true, list: { env: 'staging', issuedMs: 0, expiresMs: Number.MAX_SAFE_INTEGER, boards: [{ hv: 8, minimumFb: 440.2, releases: [release] }] } }, download: null, trust: [], settings: [], firmware: [], installed: null, pollingSwitches: false, notice: null, step: { kind: 'idle' }, compare: null },
    } as unknown as LiveView;
    const html = renderToString(h(FirmwareTab, { view }));
    expect(html).toContain('Updating 3Y2462-WWR: 450.02 → 450.02 (signed release)');
    expect(html).toContain('data-board-shown="updating"');
    expect(html).not.toContain('Firmware not read');
    expect(html).not.toContain('Connect a board');
    expect(html).toContain('data-release="tinyg-450.02.hex"');
    expect(html).toContain('data-region="firmware-update"');
  });
});
