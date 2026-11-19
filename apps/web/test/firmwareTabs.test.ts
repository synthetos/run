/**
 * Board → Firmware in sub-tabs (owner walk 2026-11-19: no scrolling): Update, Firmware backups, Custom firmware;
 * while an update runs or its settings check is open, only Update is offered.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { firmwareSubTab, openFirmwareUpdate, boardTab } from '../src/workspace/boardNavigation.ts';
import type { LiveView, WorkspaceModel } from '../src/workspace/model.ts';
import { FirmwareSection } from '../src/workspace/views/board/firmwareTabs.ts';
import { boardView } from './boardViews.ts';

const model = (view: LiveView): WorkspaceModel => ({ live: signal(view), actions: signal(null) }) as unknown as WorkspaceModel;
const tabs = (out: string): string[] => [...out.matchAll(/data-subtab="([^"]+)"/g)].map((m) => m[1] as string);

afterEach(() => {
  firmwareSubTab.value = null;
});

describe('FirmwareSection', () => {
  it('three sub-tabs, Update first; each part shows alone', () => {
    const out = renderToString(h(FirmwareSection, { model: model(boardView()) }));
    expect(tabs(out)).toEqual(['update', 'images', 'custom']);
    expect(out).not.toContain('Firmware image backups');
    firmwareSubTab.value = 'images';
    expect(renderToString(h(FirmwareSection, { model: model(boardView()) }))).toContain('Firmware image backups');
    firmwareSubTab.value = 'custom';
    const custom = renderToString(h(FirmwareSection, { model: model(boardView()) }));
    expect(custom).toContain('Custom firmware');
    expect(custom).toContain('Trusted custom builds');
  });

  it('only Update while a settings check after an update is open', () => {
    const v = boardView();
    const m = v.message as NonNullable<LiveView['message']>;
    const busy = { ...v, message: { ...m, postFlash: { boardId: 'SIM-EN-0001', phase: 'restoreRequired', differences: [] } } } as unknown as LiveView;
    firmwareSubTab.value = 'custom';
    expect(tabs(renderToString(h(FirmwareSection, { model: model(busy) })))).toEqual(['update']);
  });

  it('the ways into Firmware open its Update sub-tab', () => {
    firmwareSubTab.value = 'custom';
    openFirmwareUpdate();
    expect(firmwareSubTab.value).toBe('update');
    expect(boardTab.value).toBe('firmware');
  });
});
