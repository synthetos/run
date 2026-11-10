/**
 * The viewer's one settings button (owner, 2026-11-09): a gear that opens a small menu with the bed (its size and
 * where it comes from), the bed, fixture and stock settings, the hint that a click on a part opens its settings, and
 * in Advanced the carving detail. A native details/summary, so it opens before hydration and with the keyboard.
 * Opening a setting is navigation only.
 */
import { h, type ComponentChild } from 'preact';
import { Icon } from '../workspace/icons.ts';
import { cellText } from './CarveKey.ts';
import type { JobScene } from './sceneModel.ts';
import { SCENE_PARTS, type ScenePart } from './sceneSettings.ts';
import type { CarveInfo } from './useCarve.ts';

/** "Click the bed, fixture or stock to change it", naming the parts the scene has. */
export function pickHint(parts: readonly ScenePart[]): string {
  const names = parts.map((p) => (p === 'bed' ? 'the bed' : p));
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1] as string}`;
  return `Click ${list} to change it`;
}

export function ViewerMenu({ scene, carve = null, simple, onOpen }: { readonly scene: JobScene | null; readonly carve?: CarveInfo | null; readonly simple: boolean; readonly onOpen?: (part: ScenePart) => void }): ComponentChild {
  if (scene === null) return null;
  const parts: ScenePart[] = ['bed', ...(scene.layers.solids.some((s) => s.tag === 'fixture') ? (['fixture'] as const) : []), 'stock'];
  return h(
    'details',
    { class: 'viewer-menu', 'data-preview': 'viewer-menu' },
    h('summary', { class: 'viewer-menu-button', 'aria-label': 'View settings', title: 'Bed, fixture and stock' }, Icon('settings', 16)),
    h(
      'div',
      { class: 'viewer-menu-list', role: 'menu' },
      h('p', { class: 'viewer-menu-info', 'data-scene': 'bed' }, simple ? scene.bedSize ?? scene.bedLabel : scene.bedLabel),
      onOpen === undefined
        ? h('p', { class: 'fine' }, 'Settings are locked while a job runs.')
        : parts.map((p) => h('button', { type: 'button', key: p, class: 'viewer-menu-item', role: 'menuitem', 'data-scene-link': p, onClick: (e?: Event) => { (e?.currentTarget as HTMLElement | undefined)?.closest('details')?.removeAttribute('open'); onOpen(p); } }, SCENE_PARTS[p].settings)),
      onOpen === undefined ? null : h('p', { class: 'fine', 'data-scene': 'pick-hint' }, pickHint(parts)),
      simple || carve === null ? null : h('p', { class: 'fine viewer-menu-info' }, `Carving detail ${cellText(carve.cell)}`),
    ),
  );
}
