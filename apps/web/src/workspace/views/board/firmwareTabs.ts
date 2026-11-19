/**
 * Board → Firmware in sub-tabs (owner walk 2026-11-19: no scrolling): Update (this board's firmware, the releases
 * and the update steps), Firmware backups, and Custom firmware. While an update runs or its settings check is open,
 * only Update is offered, so its progress, restore and switch check are always in view.
 */
import { h, type ComponentChild } from 'preact';
import type { WorkspaceModel } from '../../model.ts';
import { CustomFirmware, ImageBackups } from '../FirmwareBackups.ts';
import { FirmwareTab } from '../FirmwareViews.ts';
import { SubTabs, subTabChoice, type SubTab } from './subTabs.ts';

const ALL: readonly SubTab[] = [
  { id: 'update', label: 'Update' },
  { id: 'images', label: 'Firmware backups' },
  { id: 'custom', label: 'Custom firmware' },
];

export function FirmwareSection({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const m = model?.live.value.message ?? null;
  const flash = m?.flash ?? null;
  const busy = (flash !== null && flash.phase !== 'done' && flash.phase !== 'failed') || (m?.postFlash !== null && m?.postFlash !== undefined);
  const part = (id: string): ComponentChild => (id === 'images' ? h(ImageBackups, { model }) : id === 'custom' ? h(CustomFirmware, { model }) : h(FirmwareTab, { model }));
  return h('div', { class: 'firmware-tab' }, h(SubTabs, { name: 'Firmware', prefix: 'board-firmware', tabs: busy ? ALL.slice(0, 1) : ALL, choice: subTabChoice.firmware, render: part }));
}
