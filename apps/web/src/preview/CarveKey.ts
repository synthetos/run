/**
 * The carving part of the scene's key (docs/design/tool-sim.md, slices 2 and 3): one line saying the stock is
 * carved and at what cell size ("Carving at 0.25 mm"), the notes naming lines that are not carved because their
 * tool is unknown, and the note where the cut goes below the stock. It never says the job is safe. `data-carved-through`, `data-carve-cell` and
 * `data-carve-done` say how far the carve has got, for tests.
 */
import { h, type ComponentChild } from 'preact';
import type { CarveInfo } from './useCarve.ts';

/** A cell size in plain millimetres: 0.25, 0.3, 1.25. */
export function cellText(cell: number): string {
  return `${String(Number(cell.toFixed(3)))} mm`;
}

/**
 * The key line's carving part: "Carving detail 0.25 mm" in Advanced; nothing visible in Simple unless the carve
 * stopped. It carries the test hooks at both levels. Reads the progress signal, so only this re-renders while the
 * carve runs.
 */
export function CarveLabel({ carve, simple = false }: { readonly carve: CarveInfo; readonly simple?: boolean }): ComponentChild {
  const s = carve.status.value;
  const text = s.failed !== null ? 'Carving stopped' : simple ? '' : `Carving detail ${cellText(carve.cell)}`;
  return h(
    'span',
    { 'data-scene': 'carve', 'data-carve-cell': String(carve.cell), 'data-carved-through': String(s.through), 'data-carve-done': s.done ? 'true' : 'false', 'data-carve-lowest': s.lowest.toFixed(3), ...(text === '' ? { hidden: true } : {}) },
    text,
  );
}

/** A depth below the stock in plain millimetres: 0.6, 1.2, or 0.05 for a small one. */
export function depthText(mm: number): string {
  return `${mm >= 0.1 ? mm.toFixed(1) : mm.toFixed(2)} mm`;
}

/**
 * The below-stock note: where the carve first goes below the stock and how far, and the deepest point when it
 * is elsewhere. It reads the planned setup, so it says so; it never says safe or verified, and it gates nothing.
 */
export function belowText(below: NonNullable<CarveInfo['status']['value']['below']>): string {
  const first = `The tool goes ${depthText(below.firstDepth)} below the stock at line ${String(below.firstLine)}`;
  const deeper = below.deepestLine !== below.firstLine ? `, and ${depthText(below.deepestDepth)} below at line ${String(below.deepestLine)}` : '';
  return `${first}${deeper} (preview, from the planned setup)`;
}

/** The below-stock note for the key line, or null. Reads the progress signal. */
export function BelowNote({ carve }: { readonly carve: CarveInfo }): ComponentChild {
  const below = carve.status.value.below;
  return below === null ? null : h('span', { class: 'scene-carve-note', 'data-scene': 'below-stock-note', 'data-below-line': String(below.firstLine) }, belowText(below));
}

/**
 * The uncarved-lines notes, for the key line beside the carve line. On the key line (at the drawing's foot), not
 * in the notes box at the top, so they never grow over the middle of a small drawing, where a click picks a part.
 */
export function carveNotes(carve: CarveInfo | null): ComponentChild[] {
  return (carve?.uncarved ?? []).map((n, i) => h('span', { key: `carve${String(i)}`, class: 'scene-carve-note', 'data-scene': 'carve-note' }, n));
}
