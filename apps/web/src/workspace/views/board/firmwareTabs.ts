/**
 * Board → Firmware in sub-tabs (owner walk 2026-11-19: no scrolling): Update (this board's firmware, the releases
 * and the update steps), Firmware backups, and Custom firmware. While an update runs or its settings check is open
 * (any post-flash phase but clear), only Update is offered, so its progress, restore and switch check stay in view.
 */
import { h, type ComponentChild } from 'preact';
import { BackToSetup, setupWaiting } from '../../../wizard/BackToSetup.ts';
import type { WorkspaceModel } from '../../model.ts';
import { updateBusy } from '../../updateStart.ts';
import { CustomFirmware, ImageBackups } from '../FirmwareBackups.ts';
import { FirmwareTab } from '../FirmwareViews.ts';
import { SubTabs, subTabChoice, type SubTab } from './subTabs.ts';

const ALL: readonly SubTab[] = [
  { id: 'update', label: 'Update' },
  { id: 'images', label: 'Firmware backups' },
  { id: 'custom', label: 'Custom firmware' },
];

export function FirmwareSection({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const flash = model?.live.value.message?.flash ?? null;
  const flashing = flash !== null && flash.phase !== 'done' && flash.phase !== 'failed';
  const busy = updateBusy(model?.live.value ?? null);
  const part = (id: string): ComponentChild => (id === 'images' ? h(ImageBackups, { model }) : id === 'custom' ? h(CustomFirmware, { model }) : h(FirmwareTab, { model }));
  // The setup wizard's way back sits at the end of the sub-tab row while the person came from its firmware step (owner 169).
  const end = setupWaiting.value ? h(BackToSetup, { flashing }) : null;
  return h('div', { class: 'firmware-tab' }, h(SubTabs, { name: 'Firmware', prefix: 'board-firmware', tabs: busy ? ALL.slice(0, 1) : ALL, choice: subTabChoice.firmware, render: part, end }));
}
