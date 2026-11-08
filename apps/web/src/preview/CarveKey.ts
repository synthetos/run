/**
 * The carving part of the scene's key (docs/design/tool-sim.md, slice 2): one line saying the stock is carved
 * and at what cell size ("Carving at 0.25 mm"), and the notes naming lines that are not carved because their
 * tool is unknown. It never says the job is safe. `data-carved-through`, `data-carve-cell` and
 * `data-carve-done` say how far the carve has got, for tests.
 */
import { h, type ComponentChild } from 'preact';
import type { CarveInfo } from './useCarve.ts';

/** A cell size in plain millimetres: 0.25, 0.3, 1.25. */
export function cellText(cell: number): string {
  return `${String(Number(cell.toFixed(3)))} mm`;
}

/** The key line. Reads the progress signal, so only this re-renders while the carve runs. */
export function CarveLabel({ carve }: { readonly carve: CarveInfo }): ComponentChild {
  const s = carve.status.value;
  return h(
    'span',
    { 'data-scene': 'carve', 'data-carve-cell': String(carve.cell), 'data-carved-through': String(s.through), 'data-carve-done': s.done ? 'true' : 'false', 'data-carve-lowest': s.lowest.toFixed(3) },
    s.failed === null ? `Carving at ${cellText(carve.cell)}` : 'Carving stopped',
  );
}

/** The uncarved-lines notes, one paragraph each. */
export function carveNotes(carve: CarveInfo | null): ComponentChild[] {
  return (carve?.uncarved ?? []).map((n, i) => h('p', { key: `carve${String(i)}`, 'data-scene': 'carve-note' }, n));
}
